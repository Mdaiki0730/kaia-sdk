import { Web3 } from "./../../../index.js";
import { Transaction, HexString } from "web3-types";
import { decodeParameters } from "web3-eth-abi";
import _ from "lodash";
import GaslessSwapRouterJson from "./GaslessSwapRouter.json";
import {
    parseTransaction,
} from "@kaiachain/js-ext-core";

export interface TransactionRequest extends Transaction {
    txSignatures?: any[];
    feePayer?: string;
    feePayerSignatures?: any[];
}

// Normalize transaction request in Object or RLP format
export async function getTransactionRequest(
    transactionOrRLP: TransactionRequest | string | Transaction
): Promise<Transaction> {
    if (_.isString(transactionOrRLP)) {
        const parsed = parseTransaction(transactionOrRLP);
        return {
            ...parsed,
            type: parsed.type ? BigInt(parsed.type) : undefined
        } as Transaction;
    } else {
        return transactionOrRLP as Transaction;
    }
}

/**
 * Calculate the amount to repay based on whether approval is required and gas price
 * @param approveRequired Whether approval transaction is required
 * @param gasPrice Gas price in gwei (default: 25gwei)
 * @returns The amount to repay
 */
export function getAmountRepay(approveRequired: boolean, gasPrice: number | string = 25): string {
    const gasPriceBN = typeof gasPrice === 'number'
        ? BigInt(Math.floor(gasPrice * 1e9))
        : BigInt(gasPrice);

    const lendTxGas = BigInt(21000);
    const approveTxGas = approveRequired ? BigInt(100000) : BigInt(0);
    const swapTxGas = BigInt(500000);

    const R1 = gasPriceBN * lendTxGas;
    const R2 = gasPriceBN * approveTxGas;
    const R3 = gasPriceBN * swapTxGas;

    const amountRepay = R1 + R2 + R3;

    return amountRepay.toString();
}

// Contract addresses for gasless swap routers
const MainnetGaslessSwapRouterAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";  // Actual address from JSON
const KairosGaslessSwapRouterAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"; // Using same address for testnet for now
const LocalGaslessSwapRouterAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

/**
 * Get the gasless swap router for the specified chain
 * @param web3 The web3 instance 
 * @param chainId The chain ID
 * @returns The gasless swap router contract
 */
export function getGaslessSwapRouter(web3: Web3, chainId: number): any {
    const MAINNET_CHAIN_ID = 8217; // Kaia mainnet
    const KAIROS_CHAIN_ID = 1001; // Kaia testnet (Kairos)
    const LOCAL = 1000;

    let routerAddress: string;

    if (chainId === MAINNET_CHAIN_ID) {
        routerAddress = MainnetGaslessSwapRouterAddress;
    } else if (chainId === KAIROS_CHAIN_ID) {
        routerAddress = KairosGaslessSwapRouterAddress;
    } else if (chainId === LOCAL) {
        routerAddress = LocalGaslessSwapRouterAddress;
    } else {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    return new web3.eth.Contract(
        GaslessSwapRouterJson.abi,
        routerAddress
    );
}

/**
 * Get the commission rate for the specified gasless swap router
 * @param gsr The gasless swap router contract
 * @returns The commission rate
 */
export async function getCommissionRate(gsr: any): Promise<number> {
    const rate = await gsr.methods.commissionRate().call();
    return Number(rate) / 10000;
}

/**
 * Calculate the minimum amount out based on amount to repay, app transaction fee, and commission rate
 * @param amountRepay The amount to repay
 * @param appTxFee The application transaction fee
 * @param commissionRate The commission rate
 * @returns The minimum amount out
 */
export function getMinAmountOut(
    amountRepay: string,
    appTxFee: string,
    commissionRate: number
): string {
    // Calculate minimum amount out: appTxFee/(1 - commissionRate) + amountRepay
    const appTxFeeBN = BigInt(appTxFee);
    const amountRepayBN = BigInt(amountRepay);

    const commissionRateBN = BigInt(Math.floor(commissionRate * 10000));
    const denominator = BigInt(10000);

    const adjustedFee = appTxFeeBN * denominator / (denominator - commissionRateBN);
    const minAmountOut = adjustedFee + amountRepayBN;

    return minAmountOut.toString();
}

/**
 * Calculate the amount in based on minimum amount out and slippage
 * @param gsr The gasless swap router contract
 * @param token The token address
 * @param minAmountOut The minimum amount out
 * @param slippage The slippage percentage (e.g., 0.5 for 0.5%)
 * @returns The amount in
 */
export async function getAmountIn(
    gsr: any,
    token: string,
    minAmountOut: string,
    slippage: number
): Promise<string> {
    const minAmountOutBN = BigInt(minAmountOut);
    const slippageBN = BigInt(Math.floor(slippage * 10000));
    const denominator = BigInt(10000);

    const adjustedMinAmountOut = minAmountOutBN * (denominator + slippageBN) / denominator;

    const amountIn = await gsr.methods.getAmountIn(token, adjustedMinAmountOut.toString()).call();
    return amountIn;
}

/**
 * Generate a raw approve transaction
 * @param web3 The web3 instance
 * @param tokenAddr The token address or contract
 * @param amount The amount to approve (default: MaxUint256)
 * @param privateKey The private key of the account
 * @returns The raw approve transaction
 */
export async function getApproveRawTx(
    web3: Web3,
    tokenAddr: string,
    amount: string,
    privateKey: HexString
): Promise<string> {
    try {
        const chainId = await web3.eth.getChainId();
        const gsr = getGaslessSwapRouter(web3, Number(chainId));

        const tokenAbi = [{
            "constant":true,
            "inputs":[{"name":"spender","type":"address"}, {"name":"amount","type":"uint256"}],
            "name":"approve",
            "outputs":[{"name":"","type":"bool"}],
            "type":"function"
        }];

        const tokenContract = new web3.eth.Contract(
            tokenAbi,
            tokenAddr
        );

        const amountBN = BigInt(amount);
        if (amountBN <= BigInt(0)) {
            throw new Error("Amount must be greater than 0");
        }

        const approveData = tokenContract.methods.approve(gsr.options.address, amountBN).encodeABI();

        const sender = await web3.eth.accounts.privateKeyToAccount(privateKey);
        const nonce = await web3.eth.getTransactionCount(sender.address);
        const gasPriceBN = await web3.eth.getGasPrice();

        const tx = {
            type: 0,
            to: tokenAddr,
            nonce: nonce,
            gasLimit: 100000,
            gasPrice: gasPriceBN || "25000000000",
            data: approveData,
            value: "0",
            chainId: chainId,
        };

        const signResult = await sender.signTransaction(tx)
        return signResult.rawTransaction
    } catch (error) {
        console.error("Error in getApproveRawTx:", error);
        throw error;
    }
}

/**
 * Generate a raw swap transaction
 * @param web3 The web3 instance
 * @param tokenAddr The token address to swap
 * @param amountIn The amount to swap
 * @param minAmountOut The minimum amount out
 * @param amountRepay The amount to repay
 * @param isSingle Whether this is a single transaction (default: true)
 * @param deadline The deadline in seconds (default: 1800)
 * @param privateKey The private key of the account
 * @returns The raw swap transaction
 */
export async function getSwapRawTx(
    web3: Web3,
    tokenAddr: string,
    amountIn: string,
    minAmountOut: string,
    amountRepay: string,
    isSingle: boolean = true,
    deadline: number = 1800,
    privateKey: HexString
): Promise<string> {
    try {
        const chainId = await web3.eth.getChainId();
        const gsr = getGaslessSwapRouter(web3, Number(chainId));

        const currentBlock = await web3.eth.getBlock("latest");
        if (!currentBlock) {
            throw new Error("Failed to get latest block");
        }
        const deadlineTimestamp = currentBlock.timestamp + BigInt(deadline);

        const routerAbi = [{
            "constant": true,
            "inputs": [{ "name": "token", "type": "address" }, { "name": "amountIn", "type": "uint256" }, { "name": "minAmountOut", "type": "uint256" }, { "name": "amountRepay", "type": "uint256" }, { "name": "deadline", "type": "uint256" }],
            "name": "swapForGas",
            "outputs": [],
            "type": "function"
        }];

        const routerContract = new web3.eth.Contract(
            routerAbi,
            gsr.options.address
        );

        const swapData = routerContract.methods.swapForGas(
            tokenAddr,
            amountIn,
            minAmountOut,
            amountRepay,
            deadlineTimestamp
        ).encodeABI();

        const sender = await web3.eth.accounts.privateKeyToAccount(privateKey);
        const baseNonce = await web3.eth.getTransactionCount(sender.address);
        const nonceIncrement = isSingle ? 0n : 1n;
        const nonce = baseNonce + nonceIncrement;

        const gasPriceBN = await web3.eth.getGasPrice();

        const tx = {
            type: 0,
            to: gsr.options.address,
            nonce: nonce,
            gasLimit: 500000,
            gasPrice: gasPriceBN || "25000000000",
            data: swapData,
            value: 0,
            chainId: chainId,
        };
        console.log(tx);

        const signResult = await sender.signTransaction(tx)
        return signResult.rawTransaction
    } catch (error) {
        console.error("Error in getSwapRawTx:", error);
        throw error;
    }
}

/**
 * Send gasless transactions
 * @param web3 The web3 instance
 * @param approveTxOrNull The approve transaction or null if not needed
 * @param swapTx The swap transaction
 * @returns Array of transaction hashes
 */
export async function sendGaslessTx(
    web3: Web3,
    approveTxOrNull: string | null,
    swapTx: string,
): Promise<string[]> {
    try {
        if (web3.provider) {
            if (approveTxOrNull) {
                console.log("Sending both approve and swap transactions via RPC...");
                return await web3.requestManager.send({
                    method: "klay_sendRawTransactions",
                    params: [[approveTxOrNull, swapTx]],
                })
            } else {
                return await web3.requestManager.send({
                    method: "klay_sendRawTransactions",
                    params: [[swapTx]],
                })
            }
        } else {
            console.log("No provider available, simulating transaction sending...");
            if (approveTxOrNull) {
                return [
                    `0x${approveTxOrNull.slice(2, 10).padEnd(64, '0')}`,
                    `0x${swapTx.slice(2, 10).padEnd(64, '0')}`
                ];
            } else {
                return [`0x${swapTx.slice(2, 10).padEnd(64, '0')}`];
            }
        }
    } catch (error) {
        console.error("Error in sendGaslessTx:", error);
        throw error;
    }
}

/**
 * Check if a token is supported for gasless transactions
 * @param web3 The web3 instance
 * @param token The token address
 * @param chainId The chain ID
 * @returns True if the token is supported, false otherwise
 */
export async function isGaslessSupportedToken(
    web3: Web3,
    token: string,
    chainId: number
): Promise<boolean> {
    try {
        const gsr = getGaslessSwapRouter(web3, chainId);

        return await gsr.methods.isTokenSupported(token).call();
    } catch (error) {
        console.error("Error in isGaslessSupportedToken:", error);
        return false;
    }
}

/**
 * Check if a transaction is a gasless approve transaction
 * @param web3 The web3 instance
 * @param tx The transaction
 * @param chainId The chain ID
 * @returns True if the transaction is a gasless approve transaction, false otherwise
 */
export async function isGaslessApprove(
    web3: Web3,
    tx: string | any,
    chainId: number,
): Promise<boolean> {
    try {
        const txRequest = await getTransactionRequest(tx);

        if (!txRequest.data || !txRequest.to) {
            return false;
        }

        // A1: GaslessApproveTx.to is a whitelisted ERC-20 token.
        const isTokenSupported = await isGaslessSupportedToken(web3, txRequest.to.toString(), chainId);
        if (!isTokenSupported) {
            return false;
        }

        // A2: GaslessApproveTx.data is approve(spender, amount).
        const dataPrefix = txRequest.data.toString().slice(0, 10);
        const approveMethodId = "0x095ea7b3";

        if (dataPrefix !== approveMethodId) {
            return false;
        }

        const data = txRequest.data.toString();
        const spenderData = "0x" + data.slice(34, 74);
        const amountData = "0x" + data.slice(74);

        // A3: spender is a whitelisted GaslessSwapRouter.
        const router = getGaslessSwapRouter(web3, chainId);

        if (spenderData.toLowerCase() !== router.options.address.toLowerCase()) {
            return false;
        }

        // A4: amount is a nonzero.
        const amount = BigInt(amountData);
        if (amount === BigInt(0)) {
            return false;
        }

        // A5: nonce is getNonce(tx.from).
        if (txRequest.nonce !== undefined && txRequest.nonce !== null && txRequest.from) {
            if (web3.provider) {
                const expectedNonce = await web3.eth.getTransactionCount(txRequest.from);
                if (BigInt(txRequest.nonce.toString()) !== BigInt(expectedNonce)) {
                    return false;
                }
            }
        }

        return true;
    } catch (error) {
        console.error("Error in isGaslessApprove:", error);
        return false;
    }
}

/**
 * Check if transactions form a valid gasless swap
 * @param web3 The web3 instance
 * @param approveTxOrNull The approve transaction or null if not needed
 * @param swapTx The swap transaction
 * @param chainId The chain ID
 * @returns True if the transactions form a valid gasless swap, false otherwise
 */
export async function isGaslessSwap(
    web3: Web3,
    approveTxOrNull: string | any | null,
    swapTx: string | any,
    chainId: number,
): Promise<boolean> {
    try {
        const swapTxRequest = await getTransactionRequest(swapTx);

        if (!swapTxRequest.data || !swapTxRequest.to) {
            return false;
        }

        // S1: GaslessSwapTx.to is a whitelisted GaslessSwapRouter.
        const router = getGaslessSwapRouter(web3, chainId);

        if (swapTxRequest.to.toLowerCase() !== router.options.address.toLowerCase()) {
            return false;
        }

        // S2: GaslessSwapTx.data is swapForGas(token, amountIn, amountOut, amountRepay, deadline).
        // TODO: Check if the function signature is for swapForGas
        const data = swapTxRequest.data.toString();

        const paramTypes = ['address', 'uint256', 'uint256', 'uint256', 'uint256'];
        const inputData = "0x" + data.slice(10);

        let decodedParams: { [key: string]: unknown; __length__: number };
        let tokenData: string;
        let amountInData: string;
        let amountOutData: string;
        let amountRepayData: string;
        let deadlineData: string;

        try {
            decodedParams = decodeParameters(paramTypes, inputData);
            console.log(decodedParams);
            tokenData = decodedParams[0] as string;
            amountInData = (decodedParams[1] as bigint).toString();
            amountOutData = (decodedParams[2] as bigint).toString();
            amountRepayData = (decodedParams[3] as bigint).toString();
            deadlineData = (decodedParams[4] as bigint).toString();
        } catch (error) {
            console.error("Error decoding swap parameters:", error);
            return false;
        }

        // S3: token is a whitelisted ERC20 token.
        const isTokenSupported = await isGaslessSupportedToken(web3, tokenData, chainId);
        if (!isTokenSupported) {
            console.log("!isTokenSupported")
            return false;
        }

        if (approveTxOrNull) {
            console.log("approveTxOrNull")
            const isApprove = await isGaslessApprove(web3, approveTxOrNull, chainId);
            if (!isApprove) {
                console.log("!isApprove")
                return false;
            }

            const approveTxRequest = await getTransactionRequest(approveTxOrNull);

            // SP1: GaslessApproveTx.to=token.
            console.log(approveTxRequest.to?.toLowerCase(), tokenData.toLowerCase())
            if (approveTxRequest.to?.toLowerCase() !== tokenData.toLowerCase()) {
                console.log("approveTxRequest.to?.toLowerCase() !== tokenData.toLowerCase()")
                return false;
            }

            const approveData = approveTxRequest.data?.toString() || "";
            const approveAmountData = "0x" + approveData.slice(74); // Extract amount
            const approveAmount = BigInt(approveAmountData);
            const amountIn = BigInt(amountInData);

            // SP2: GaslessApproveTx.data.amount>=amountIn.
            if (approveAmount < amountIn) {
                console.log("approveAmount < amountIn")
                return false;
            }

            // SP3: Nonce is the correct value.
            if (swapTxRequest.nonce !== undefined && swapTxRequest.nonce !== null &&
                approveTxRequest.nonce !== undefined && approveTxRequest.nonce !== null) {
                if (BigInt(approveTxRequest.nonce.toString()) + BigInt(1) !== BigInt(swapTxRequest.nonce.toString())) {
                    console.log(`Non-sequential nonces: approveTx.nonce=${approveTxRequest.nonce}, swapTx.nonce=${swapTxRequest.nonce}`);
                    return false;
                }

                try {
                    if (web3.provider && swapTxRequest.from) {
                        const currentNonce = await web3.eth.getTransactionCount(swapTxRequest.from);
                        if (BigInt(approveTxRequest.nonce.toString()) !== BigInt(currentNonce)) {
                            console.log(`Approve nonce mismatch: approveTx.nonce=${approveTxRequest.nonce}, currentNonce=${currentNonce}`);
                            return false;
                        }
                    }
                } catch (error) {
                    console.error("Error checking nonce:", error);
                    return false;
                }
            }

            // SP4: amountRepay is the correct value.
            const gasPrice = swapTxRequest.gasPrice?.toString() || "25000000000"; // Default to 25 gwei
            const expectedAmountRepay = getAmountRepay(true, Number(gasPrice) / 1000000000); // Convert to gkei

            if (BigInt(amountRepayData) !== BigInt(expectedAmountRepay)) {
                console.log(`Amount repay mismatch: amountRepay=${amountRepayData}, expectedAmountRepay=${expectedAmountRepay}`);
                return false;
            }
        } else {
            // SP3: Nonce is the correct value.
            if (swapTxRequest.nonce !== undefined && swapTxRequest.nonce !== null) {
                try {
                    if (web3.provider && swapTxRequest.from) {
                        const currentNonce = await web3.eth.getTransactionCount(swapTxRequest.from);
                        if (BigInt(swapTxRequest.nonce.toString()) !== BigInt(currentNonce)) {
                            console.log(`Swap nonce mismatch: swapTx.nonce=${swapTxRequest.nonce}, currentNonce=${currentNonce}`);
                            return false;
                        }
                    }
                } catch (error) {
                    console.error("Error checking nonce:", error);
                    return false;
                }
            }

            // SP4: amountRepay is the correct value.
            const gasPrice = swapTxRequest.gasPrice?.toString() || "25000000000"; // Default to 25 gwei
            const expectedAmountRepay = getAmountRepay(false, Number(gasPrice) / 1000000000); // Convert to gkei

            if (BigInt(amountRepayData) !== BigInt(expectedAmountRepay)) {
                console.log(`Amount repay mismatch: amountRepay=${amountRepayData}, expectedAmountRepay=${expectedAmountRepay}`);
                return false;
            }

        }

        return true;
    } catch (error) {
        console.error("Error in isGaslessSwap:", error);
        return false;
    }
}