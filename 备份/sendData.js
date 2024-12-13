const { ethers } = require('ethers');
const XLSX = require('xlsx');
const fs = require('fs');

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
        
        return { addresses, privateKeys };
    } catch (error) {
        console.error('读取 Excel 文件错误:', error);
        throw error;
    }
}

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
const contractAddress = '0xda77c035e4d5a748b4ab6674327fa446f17098a2';
//修改input data
const inputData = '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001a401c228c6000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000db3f0fae8fca21e738138ab1b8b9a6f1a2ee3600000000000000000000000055d398326f99059ff775485246999027b3197955000000000000000000000000e8622e3ea3b29b617b99366acf23bf615bf0c11c000000000000000000000000ca143ce32fe78f1f7019d7d551a6402fc5350c730000000000000000000000000000000000000000000000000000000000001b5800000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000654e5b2fe34feae50000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000000200000000000000000000000055d398326f99059ff775485246999027b3197955000000000000000000000000f87733074499c0d58ac25af158620352de84825e00000000000000000000000000000000000000000000000000000000';

async function sendTransaction(privateKey, address, index, total) {
    const wallet = new ethers.Wallet(privateKey, provider);
    try {
        const tx = {
            to: contractAddress,
            data: inputData,
            gasLimit: 1000000,
            gasPrice: ethers.parseUnits('5', 'gwei')
        };

        const transaction = await wallet.sendTransaction(tx);
        console.log(`[${index + 1}/${total}] 交易已发送`);
        console.log(`地址: ${address}`);
        console.log(`交易哈希: ${transaction.hash}`);
        
        const receipt = await transaction.wait();
        
        if (receipt.status === 1) {
            console.log(`[${index + 1}/${total}] 交易状态: ✅ 成功`);
        } else {
            console.log(`[${index + 1}/${total}] 交易状态: ❌ 失败`);
        }
        console.log(`Gas 使用: ${receipt.gasUsed.toString()} / ${receipt.gasLimit.toString()}`);
        console.log('------------------------');
        
        return { success: true, hash: transaction.hash, address };
    } catch (error) {
        console.error(`[${index + 1}/${total}] 地址 ${address} 处理失败:`, error.message);
        
        if (error.transactionHash) {
            try {
                const receipt = await provider.getTransactionReceipt(error.transactionHash);
                if (receipt) {
                    console.log(`[${index + 1}/${total}] 交易状态: ❌ 失败`);
                    console.log(`Gas 使用: ${receipt.gasUsed.toString()} / ${receipt.gasLimit.toString()}`);
                }
            } catch (e) {
                console.log('无法获取详细的失败信息');
            }
        }
        
        console.log('------------------------');
        return { success: false, error: error.message, address };
    }
}

async function sendTransactions(addresses, privateKeys) {
    const total = addresses.length;
    const promises = privateKeys.map((privateKey, index) => 
        sendTransaction(privateKey, addresses[index], index, total)
    );
    
    try {
        const results = await Promise.all(promises);
        
        // 统计结果
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log('\n执行统计:');
        console.log(`总计: ${total}`);
        console.log(`成功: ${successful}`);
        console.log(`失败: ${failed}`);
    } catch (error) {
        console.error('批量处理出错:', error);
    }
}

async function main() {
    try {
        const { addresses, privateKeys } = readExcelFile('200address.xls');
        await sendTransactions(addresses, privateKeys);
    } catch (error) {
        console.error('程序执行错误:', error);
    }
}

main();
