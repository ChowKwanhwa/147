const { ethers } = require('ethers');
const XLSX = require('xlsx');

// USDT 合约信息
const USDT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";
const SPENDER_ADDRESS = "0xda77c035e4d5a748b4ab6674327fa446f17098a2";
const USDT_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)"
];

// 设置授权金额为 250 USDT (250 * 10^18)
const APPROVE_AMOUNT = ethers.parseUnits("250", 18);

// BSC RPC节点列表
const RPC_URLS = [
    'https://bsc-mainnet.core.chainstack.com/704cf55e043a9a9cd46d83eca3e40afd',
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc-dataseed3.binance.org/',
    'https://bsc-dataseed4.binance.org/',
    'https://bsc.nodereal.io'
];

let currentRpcIndex = 0;
let provider = new ethers.JsonRpcProvider(RPC_URLS[currentRpcIndex]);

// 切换RPC节点
function switchRpcNode() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
    provider = new ethers.JsonRpcProvider(RPC_URLS[currentRpcIndex]);
    console.log(`切换到RPC节点: ${RPC_URLS[currentRpcIndex]}`);
}

// 添加延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function readExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const addresses = [];
        const privateKeys = [];
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row[0]) addresses.push(row[0]);
            if (row[2]) privateKeys.push(row[2]);
        }
        
        console.log(`找到 ${addresses.length} 个地址和 ${privateKeys.length} 个私钥`);
        console.log('示例数据验证:');
        console.log('第一个地址:', addresses[0]);
        console.log('第一个私钥:', privateKeys[0].substring(0, 10) + '...');
        console.log('授权金额: 250 USDT');
        
        return { addresses, privateKeys };
    } catch (error) {
        console.error('读取 Excel 文件错误:', error);
        throw error;
    }
}

async function approveUsdt(privateKey, address, index, total) {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            const wallet = new ethers.Wallet(privateKey, provider);
            const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, wallet);
            
            const tx = await usdtContract.approve(
                SPENDER_ADDRESS,
                APPROVE_AMOUNT,
                {
                    gasLimit: 100000,
                    gasPrice: ethers.parseUnits('5', 'gwei')
                }
            );

            console.log(`[${index + 1}/${total}] Approve 交易已发送`);
            console.log(`地址: ${address}`);
            console.log(`交易哈希: ${tx.hash}`);
            
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                console.log(`[${index + 1}/${total}] 交易状态: ✅ 成功`);
            } else {
                console.log(`[${index + 1}/${total}] 交易状态: ❌ 失败`);
            }
            console.log(`Gas 使用: ${receipt.gasUsed.toString()} / ${receipt.gasLimit.toString()}`);
            console.log('------------------------');
            
            return { success: true, hash: tx.hash, address };
            
        } catch (error) {
            retryCount++;
            console.error(`[${index + 1}/${total}] 尝试 ${retryCount}/${maxRetries} 失败:`, error.message);
            
            if (error.message.includes('limit exceeded')) {
                switchRpcNode();
            }
            
            if (retryCount < maxRetries) {
                console.log(`等待 3 秒后重试...`);
                await sleep(3000);
            } else {
                console.error(`[${index + 1}/${total}] 地址 ${address} Approve 失败:`, error.message);
                console.log('------------------------');
                return { success: false, error: error.message, address };
            }
        }
    }
}

async function batchApprove(addresses, privateKeys) {
    const total = addresses.length;
    const batchSize = 20; // 增加到20个地址一批
    const results = [];
    
    // 分批处理地址
    for (let i = 0; i < addresses.length; i += batchSize) {
        // 每个批次使用不同节点
        switchRpcNode();
        console.log(`\n处理批次 ${Math.floor(i/batchSize) + 1}/${Math.ceil(total/batchSize)}`);
        console.log(`使用节点: ${RPC_URLS[currentRpcIndex]}`);
        
        const batchAddresses = addresses.slice(i, i + batchSize);
        const batchPrivateKeys = privateKeys.slice(i, i + batchSize);
        
        const promises = batchPrivateKeys.map((privateKey, batchIndex) => 
            approveUsdt(privateKey, batchAddresses[batchIndex], i + batchIndex, total)
        );
        
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
        
        if (i + batchSize < addresses.length) {
            console.log(`等待 2 秒后处理下一批...`); // 缩短等待时间到2秒
            await sleep(2000);
        }
    }
    
    // 统计结果
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log('\n执行统计:');
    console.log(`总计: ${total}`);
    console.log(`成功: ${successful}`);
    console.log(`失败: ${failed}`);
    
    // 将结果保存到Excel文件
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(results.map(r => ({
        地址: r.address,
        状态: r.success ? '成功' : '失败',
        交易哈希: r.success ? r.hash : '',
        错误信息: r.success ? '' : r.error
    })));
    
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Approve结果');
    XLSX.writeFile(workbook, 'approve_result.xlsx');
    console.log('\n结果已保存至 approve_result.xlsx');
}

async function main() {
    try {
        const { addresses, privateKeys } = readExcelFile('./地址/200address.xls');
        await batchApprove(addresses, privateKeys);
    } catch (error) {
        console.error('程序执行错误:', error);
    }
}

main(); 