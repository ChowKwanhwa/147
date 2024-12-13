const { ethers } = require('ethers');
const XLSX = require('xlsx');

// 修改合约信息为数组
const TOKENS = [
    {
        address: "0xf87733074499c0d58ac25af158620352de84825e",
        symbol: null,  // 将通过合约自动获取
        decimals: null // 将通过合约自动获取
    },
    // 在这里添加更多代币
    {
        address: "0x55d398326f99059fF775485246999027B3197955", // USDT-BSC 示例
        symbol: null,
        decimals: null
    }
];

const TOKEN_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)"
];

// BSC RPC节点列表
const RPC_URLS = [
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc-dataseed3.binance.org/',
    'https://bsc-dataseed4.binance.org/',
    'https://bsc.nodereal.io',
    'https://bsc-mainnet.core.chainstack.com/704cf55e043a9a9cd46d83eca3e40afd',
    'https://bsc-mainnet.public.blastapi.io',
    'https://bsc.publicnode.com',
    'https://1rpc.io/bnb',
    'https://bsc.rpc.blxrbdn.com'
];

// 修改 RPC 节点管理
let currentRpcIndex = 0;
const providers = RPC_URLS.map(url => new ethers.JsonRpcProvider(url));

// 获取下一个 provider
function getNextProvider() {
    currentRpcIndex = (currentRpcIndex + 1) % providers.length;
    return providers[currentRpcIndex];
}

function readExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const addresses = [];
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row[0]) addresses.push(row[0]);
        }
        
        console.log(`找到 ${addresses.length} 个地址`);
        console.log('示例地址:', addresses[0]);
        
        return addresses;
    } catch (error) {
        console.error('读取 Excel 文件错误:', error);
        throw error;
    }
}

// 添加延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 修改参数配置
const batchSize = 20; // 增加到20个地址
const RETRY_DELAY = 500; // 减少到500ms
const BATCH_DELAY = 1000; // 减少到1秒

async function checkBalance(address, tokenContracts, index, total, provider) {
    const maxRetries = 3;
    let retryCount = 0;
    let currentProvider = provider;
    
    while (retryCount < maxRetries) {
        try {
            // 并行查询 BNB 余额和所有代币余额
            const [bnbBalance, ...tokenBalances] = await Promise.all([
                currentProvider.getBalance(address),
                ...tokenContracts.map(contract => {
                    const tokenContract = new ethers.Contract(
                        contract.address, 
                        TOKEN_ABI, 
                        currentProvider
                    );
                    return tokenContract.balanceOf(address);
                })
            ]);

            const bnbFormatted = ethers.formatEther(bnbBalance);
            const formattedTokenBalances = tokenBalances.map((balance, i) => 
                ethers.formatUnits(balance, tokenContracts[i].decimals)
            );
            
            console.log(`[${index + 1}/${total}] 地址: ${address}`);
            console.log(`BNB 余额: ${bnbFormatted} BNB`);
            tokenContracts.forEach((contract, i) => {
                console.log(`${contract.symbol} 余额: ${formattedTokenBalances[i]} ${contract.symbol}`);
            });
            console.log('------------------------');
            
            return {
                address,
                bnbBalance: bnbFormatted,
                tokenBalances: tokenContracts.map((contract, i) => ({
                    symbol: contract.symbol,
                    balance: formattedTokenBalances[i]
                })),
                success: true
            };
        } catch (error) {
            retryCount++;
            if (error.message.includes('limit exceeded') || 
                error.message.includes('rate limit') || 
                error.message.includes('CALL_EXCEPTION') ||
                error.message.includes('missing response')) {
                console.log(`[${index + 1}/${total}] 重试 ${retryCount}/${maxRetries}...`);
                currentProvider = getNextProvider();
                await sleep(RETRY_DELAY);
                continue;
            }
            
            if (retryCount === maxRetries) {
                return {
                    address,
                    success: false,
                    error: error.message
                };
            }
            
            await sleep(RETRY_DELAY);
        }
    }
}

async function batchCheckBalances(addresses) {
    try {
        // 使用多个 provider 并行初始化代币信息
        const tokenPromises = TOKENS.map(async (token, index) => {
            const provider = providers[index % providers.length];
            const contract = new ethers.Contract(token.address, TOKEN_ABI, provider);
            const [decimals, symbol] = await Promise.all([
                contract.decimals(),
                contract.symbol()
            ]);
            return {
                address: token.address,
                decimals,
                symbol
            };
        });

        const tokenContracts = await Promise.all(tokenPromises);
        
        console.log(`代币信息:`);
        tokenContracts.forEach(token => {
            console.log(`地址: ${token.address}`);
            console.log(`符号: ${token.symbol}`);
            console.log(`小数位: ${token.decimals}`);
            console.log('------------------------');
        });
        
        const total = addresses.length;
        const results = [];
        
        for (let i = 0; i < addresses.length; i += batchSize) {
            const batch = addresses.slice(i, i + batchSize);
            
            // 为批次中的每个地址分配不同的 provider
            const batchPromises = batch.map((address, index) => {
                const provider = providers[(i + index) % providers.length];
                return checkBalance(
                    address,
                    tokenContracts,
                    i + index,
                    total,
                    provider
                );
            });
            
            // 并行处理当前批次的所有地址
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // 批次之间添加更短的延迟
            if (i + batchSize < addresses.length) {
                await sleep(BATCH_DELAY);
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        let totalBnb = 0;
        const totalTokens = {};
        
        results.forEach(result => {
            if (result.success) {
                totalBnb += parseFloat(result.bnbBalance);
                result.tokenBalances.forEach(({symbol, balance}) => {
                    totalTokens[symbol] = (totalTokens[symbol] || 0) + parseFloat(balance);
                });
            }
        });
        
        console.log('\n执行统计:');
        console.log(`总计查询: ${total} 个地址`);
        console.log(`成功: ${successful}`);
        console.log(`失败: ${failed}`);
        console.log(`\n总余额统计:`);
        console.log(`BNB 总量: ${totalBnb.toFixed(4)} BNB`);
        Object.entries(totalTokens).forEach(([symbol, total]) => {
            console.log(`${symbol} 总量: ${total.toFixed(4)} ${symbol}`);
        });
        
        const workbook = XLSX.utils.book_new();
        const worksheetData = results.map(r => {
            const data = {
                地址: r.address,
                BNB余额: r.success ? r.bnbBalance : 'Error',
                状态: r.success ? '成功' : '失败',
                错误信息: r.success ? '' : r.error
            };
            if (r.success) {
                r.tokenBalances.forEach(({symbol, balance}) => {
                    data[`${symbol}余额`] = balance;
                });
            }
            return data;
        });
        
        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Balances');
        XLSX.writeFile(workbook, 'balances_result.xlsx');
        console.log('\n结果已保存至 balances_result.xlsx');
        
    } catch (error) {
        console.error('批量查询出错:', error);
    }
}

async function main() {
    try {
        const addresses = readExcelFile('./地址/200address.xls');
        await batchCheckBalances(addresses);
    } catch (error) {
        console.error('程序执行错误:', error);
    }
}

main();