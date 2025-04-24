import { assert } from "chai";
import { describe, it } from "mocha";
import { Web3 } from "web3";

import { KlaytnWeb3 } from "../src";
import { 
    getAmountRepay,
    getGaslessSwapRouter,
    getCommissionRate,
    getMinAmountOut,
    getAmountIn,
    getApproveRawTx,
    getSwapRawTx,
    sendGaslessTx,
    isGaslessSupportedToken,
    isGaslessApprove,
    isGaslessSwap
} from "../src";
import GaslessSwapRouterJson from "../src/eth/utils/gasless/GaslessSwapRouter.json";

import { MockProvider } from "./mock_provider";


// Dummy values.

/* eslint-disable quotes */
const url = "https://public-en-kairos.node.kaia.io";
const from = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const routerAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
const gasPrice = 25e9;
const gwei = 1e9;
const chainId = 1001;
const testTokenAddr = "0x0000000000000000000000000000000000000001";
const approveTxBase = {
  type: 0,
  to: testTokenAddr,
  data: "0x095ea7b30000000000000000000000005fc8d32690cc91d4c39d9d3abcbd16989f8757070000000000000000000000000000000000000000000000000de0b6b3a7640000",
  nonce: "0x0",
  from: from,
  gasLimit: "0x186a0",
  gasPrice: "0xba43b7400",
  value: "0x0"
};
const swapTxBase = {
  type: 0,
  to: routerAddress,
  data: "0x8042690100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000000c7d713b49da0000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000005f5e808",
  nonce: "0x1",
  from: from,
  gasLimit: "0x7a120",
  gasPrice: "0xba43b7400",
  value: "0x0"
};
/* eslint-enable quotes */


// Test each functions of web3/util/gasless
describe("web3/util/gasless", () => {
  let P: MockProvider;
  let EW3: Web3;
  let KW3: KlaytnWeb3;

  before(() => {
    P = new MockProvider(url);
    EW3 = new Web3(P);
    KW3 = new KlaytnWeb3(P);

    // Stuff dummy values to the mock provider
    P.mock_override("eth_getTransactionCount", () => "0x1234");
    P.mock_override("eth_chainId", () => "0x3e9");
    P.mock_override("net_version", () => "0x3e9");
    P.mock_override("eth_blockNumber", () => "0x12d687");
    P.mock_override("eth_gasPrice", () => "0xba43b7400");
    P.mock_override("eth_estimateGas", () => "0x5208");
  });

  it("getAmountRepay()", async () => {
    const costomGas = 1
    const gasExceptApprove = BigInt(521000) * BigInt(gasPrice)
    const gasExceptApproveWithCostomGas = BigInt(521000) * BigInt(costomGas * gwei)
    const gasIncludeApprove = BigInt(621000) * BigInt(gasPrice)
    const gasIncludeApproveWithCostomGas = BigInt(621000) * BigInt(costomGas * gwei)


    assert.equal(getAmountRepay(false), gasExceptApprove.toString());
    assert.equal(getAmountRepay(false, costomGas), gasExceptApproveWithCostomGas.toString());
    assert.equal(getAmountRepay(true), gasIncludeApprove.toString());
    assert.equal(getAmountRepay(true, costomGas), gasIncludeApproveWithCostomGas.toString());
  });

  it("getGaslessSwapRouter()", async () => {
    const unsupportedChainId = 1
    const expectedError = new Error(`Unsupported chain ID: ${unsupportedChainId}`)

    const contract = new KW3.eth.Contract(GaslessSwapRouterJson.abi, routerAddress)

    assert.deepEqual(getGaslessSwapRouter(KW3, 8217).options.address?.toLowerCase(), contract.options.address?.toLowerCase()); // chain is mainnet
    assert.deepEqual(getGaslessSwapRouter(KW3, 1001).options.address?.toLowerCase(), contract.options.address?.toLowerCase()); // chain is kairos
    assert.deepEqual(getGaslessSwapRouter(KW3, 1000).options.address?.toLowerCase(), contract.options.address?.toLowerCase()); // chain is local
    assert.throws(function () {
      getGaslessSwapRouter(KW3, unsupportedChainId); 
    }, expectedError.message) // expect error
  });

  it("getCommissionRate()", async () => {
    const gsr = new KW3.eth.Contract(GaslessSwapRouterJson.abi, routerAddress)

    P.mock_override("eth_call", () => "0x00000000000000000000000000000000000000000000000000000000000003E8"); // 1000
    const result = await getCommissionRate(gsr)
    assert.equal(result, 0.1);
  });
  
  it("getMinAmountOut()", async () => {
    const amountRepay = "1000000000000000000"; // 1 KAIA
    const appTxFee = "500000000000000000"; // 0.5 KAIA
    const commissionRate = 0.1; // 10%

    // Test case 1: Basic calculation
    const expectedMinAmountOut1 = "1555555555555555555"; // 1.555... KAIA
    assert.equal(getMinAmountOut(amountRepay, appTxFee, commissionRate), expectedMinAmountOut1);

    // Test case 2: Zero commission rate
    const expectedMinAmountOut2 = "1500000000000000000"; // 1.5 KAIA
    assert.equal(getMinAmountOut(amountRepay, appTxFee, 0), expectedMinAmountOut2);

    // Test case 3: Zero appTxFee
    const expectedMinAmountOut3 = "1000000000000000000"; // 1 KAIA
    assert.equal(getMinAmountOut(amountRepay, "0", commissionRate), expectedMinAmountOut3);
  });

  it("getAmountIn()", async () => {
    const gsr = new KW3.eth.Contract(GaslessSwapRouterJson.abi, routerAddress);
    const token = "0x0000000000000000000000000000000000000001";
    const minAmountOut = "1000000000000000000"; // 1 ETH
    const slippage = 0.5; // 0.5%

    // Mock the getAmountIn call
    P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000"); // 1 ETH

    const amountIn = await getAmountIn(gsr, token, minAmountOut, slippage);
    assert.equal(amountIn, "1000000000000000000"); // Should return 1 ETH
  });

  it("getApproveRawTx()", async () => {
    const tokenAddr = "0x0000000000000000000000000000000000000001";
    const amount = "1000000000000000000"; // 1 KAIA
    const privateKey = "0x1b33a48f58d8c85ab142a7375fcf18714d88271f6647cfa6b54f1be66b05a762";

    // Mock the necessary calls
    P.mock_override("eth_getTransactionCount", () => "0x0");

    const rawTx = await getApproveRawTx(KW3, tokenAddr, amount, privateKey);
    assert.isString(rawTx);
    assert.match(rawTx, /^0xf8ac80850ba43b7400830186a094000000000000000000000000000000000000000180b844095ea7b30000000000000000000000005fc8d32690cc91d4c39d9d3abcbd16989f8757070000000000000000000000000000000000000000000000000de0b6b3a76400008207f5a0841d88e59ff6c89966d60543d3c901707f2ea9827cb9e6f7331967700e818d7ba03ddd2956df4e8fb945ea57bce489e12617ccead656c38646b18da20c41e9b65a/);
  });

  it("getSwapRawTx()", async () => {
    const tokenAddr = "0x0000000000000000000000000000000000000001";
    const amountIn = "1000000000000000000"; // 1 KAIA
    const minAmountOut = "900000000000000000"; // 0.9 KAIA
    const amountRepay = "100000000000000000"; // 0.1 KAIA
    const privateKey = "0x1b33a48f58d8c85ab142a7375fcf18714d88271f6647cfa6b54f1be66b05a762";

    // Mock the necessary calls
    P.mock_override("eth_getTransactionCount", () => "0x0");
    P.mock_override("eth_getBlockByNumber", () => ({ timestamp: "0x5f5e100" })); // 100000000

    const rawTx = await getSwapRawTx(KW3, tokenAddr, amountIn, minAmountOut, amountRepay, true, 1800, privateKey);
    assert.isString(rawTx);
    assert.match(rawTx, /^0xf9010c80850ba43b74008307a120945fc8d32690cc91d4c39d9d3abcbd16989f87570780b8a48042690100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000000c7d713b49da0000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000005f5e8088207f6a0e82aea107e7ce06cea698aa764180e2aa57cfb50c64f325df71ad8630df83cf7a06d7eaa0e4add2eccc9e9ed5dad530344259e89e540e363a09b0c9ad2db6ad38e/);
  });

  it("sendGaslessTx()", async () => {
    const approveTx = "0xf8ac80850ba43b7400830186a094000000000000000000000000000000000000000180b844095ea7b30000000000000000000000005fc8d32690cc91d4c39d9d3abcbd16989f8757070000000000000000000000000000000000000000000000000de0b6b3a76400008207f5a0841d88e59ff6c89966d60543d3c901707f2ea9827cb9e6f7331967700e818d7ba03ddd2956df4e8fb945ea57bce489e12617ccead656c38646b18da20c41e9b65a";
    const swapTx = "0xf9010c80850ba43b74008307a120945fc8d32690cc91d4c39d9d3abcbd16989f87570780b8a48042690100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000000c7d713b49da0000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000005f5e8088207f6a0e82aea107e7ce06cea698aa764180e2aa57cfb50c64f325df71ad8630df83cf7a06d7eaa0e4add2eccc9e9ed5dad530344259e89e540e363a09b0c9ad2db6ad38e";

    // Mock the klay_sendRawTransactions call
    P.mock_override("klay_sendRawTransactions", (params: Array<string>) => {
      if (params[0].length === 1) {
        return ["0x5678"];
      } else {
        return ["0x1234", "0x5678"];
      }
    });

    // Test with both approve and swap transactions
    const result1 = await sendGaslessTx(KW3, approveTx, swapTx);
    assert.deepEqual(result1, ["0x1234", "0x5678"]);

    // Test with only swap transaction
    const result2 = await sendGaslessTx(KW3, null, swapTx);
    assert.deepEqual(result2, ["0x5678"]);
  });

  it("isGaslessSupportedToken()", async () => {
    const token = "0x0000000000000000000000000000000000000001";

    P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000000000000000001");
    const isSupportedExpectedTrue = await isGaslessSupportedToken(KW3, token, chainId);
    assert.isTrue(isSupportedExpectedTrue);

    P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000000000000000000");
    const isSupportedExpectedFalse = await isGaslessSupportedToken(KW3, token, chainId);
    assert.isFalse(isSupportedExpectedFalse);
  });

  describe("isGaslessApprove()", async () => {
    before(() => {
      // Mock the necessary calls
      P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000000000000000001");
      P.mock_override("eth_getTransactionCount", () => "0x0");
    });

    it("Return true for valid approve transaction", async () => {
      const isApprove = await isGaslessApprove(KW3, approveTxBase, chainId);
      assert.isTrue(isApprove);
    });

    it("Return false for missing data", async () => {
      const approveTx = {
        ...approveTxBase,
        data: ""
      }
      const isApprove = await isGaslessApprove(KW3, approveTx, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for missing to address", async () => {
      const approveTx = {
        ...approveTxBase,
        to: ""
      }
      const isApprove = await isGaslessApprove(KW3, approveTx, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for unsupported token", async () => {
      P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000000000000000000");
      const isApprove = await isGaslessApprove(KW3, approveTxBase, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for wrong method ID", async () => {
      const approveTx = {
        ...approveTxBase,
        data: "0x123456780000000000000000000000000000000000000000000000000000000000000001"
      }
      const isApprove = await isGaslessApprove(KW3, approveTx, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for wrong spender address", async () => {
      const approveTx = {
        ...approveTxBase,
        data: "0x095ea7b300000000000000000000000000000000000000000000000000000001234567890000000000000000000000000000000000000000000000000de0b6b3a7640000"
      }
      const isApprove = await isGaslessApprove(KW3, approveTx, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for zero amount", async () => {
      const approveTx = {
        ...approveTxBase,
        data: "0x095ea7b30000000000000000000000005fc8d32690cc91d4c39d9d3abcbd16989f8757070000000000000000000000000000000000000000000000000000000000000000"
      }
      const isApprove = await isGaslessApprove(KW3, approveTx, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for wrong nonce", async () => {
      P.mock_override("eth_getTransactionCount", () => "0x1");
      const isApprove = await isGaslessApprove(KW3, approveTxBase, chainId);
      assert.isFalse(isApprove);
    });

    it("Return false for missing from address", async () => {
      const approveTx = {
        ...approveTxBase,
        from: ""
      }
      const isApprove = await isGaslessApprove(KW3, approveTx, chainId);
      assert.isFalse(isApprove);
    });
  });

  describe("isGaslessSwap()", async () => {
    before(() => {
      // Mock the necessary calls
      P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000000000000000001");
      P.mock_override("eth_getTransactionCount", () => "0x0");
      P.mock_override("eth_getBlock", () => ({ timestamp: "0x5f5e100" }));
    });

    it("Return true for valid swap with approve", async () => {
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTxBase, chainId);
      assert.isTrue(isSwap);
    });

    it("Return true for valid swap without approve", async () => {
      const swapTx = {
        ...swapTxBase,
        nonce: "0x0"
      };
      const isSwap = await isGaslessSwap(KW3, null, swapTx, chainId);
      assert.isTrue(isSwap);
    });

    it("Return false for missing swap data", async () => {
      const swapTx = {
        ...swapTxBase,
        data: ""
      };
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTx, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for missing swap to address", async () => {
      const swapTx = {
        ...swapTxBase,
        to: ""
      };
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTx, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for wrong router address", async () => {
      const swapTx = {
        ...swapTxBase,
        to: "0x1234567890123456789012345678901234567890"
      };
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTx, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for unsupported token", async () => {
      P.mock_override("eth_call", () => "0x0000000000000000000000000000000000000000000000000000000000000000");
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTxBase, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for invalid approve transaction", async () => {
      const approveTx = {
        ...approveTxBase,
        data: "0x123456780000000000000000000000000000000000000000000000000000000000000001"
      };
      const isSwap = await isGaslessSwap(KW3, approveTx, swapTxBase, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for non-sequential nonces with approve", async () => {
      const swapTx = {
        ...swapTxBase,
        nonce: "0x0" // Same as approve nonce
      };
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTx, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for wrong nonce without approve", async () => {
      P.mock_override("eth_getTransactionCount", () => "0x1");
      const isSwap = await isGaslessSwap(KW3, null, swapTxBase, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for token mismatch between approve and swap", async () => {
      const swapTx = {
        ...swapTxBase,
        data: swapTxBase.data.replace(testTokenAddr.slice(2), "0x0000000000000000000000000000000000000002".slice(2))
      };
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTx, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for insufficient approve amount", async () => {
      const approveTx = {
        ...approveTxBase,
        data: "0x095ea7b30000000000000000000000005fc8d32690cc91d4c39d9d3abcbd16989f8757070000000000000000000000000000000000000000000000000000000000000001" // Very small amount
      };
      const isSwap = await isGaslessSwap(KW3, approveTx, swapTxBase, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for wrong amount repay with approve", async () => {
      const swapTx = {
        ...swapTxBase,
        data: swapTxBase.data.replace(/00000000000000000000000000000000$/, "00000000000000000000000000000001")
      };
      const isSwap = await isGaslessSwap(KW3, approveTxBase, swapTx, chainId);
      assert.isFalse(isSwap);
    });

    it("Return false for wrong amount repay without approve", async () => {
      const swapTx = {
        ...swapTxBase,
        data: swapTxBase.data.replace(/00000000000000000000000000000000$/, "00000000000000000000000000000001")
      };
      const isSwap = await isGaslessSwap(KW3, null, swapTx, chainId);
      assert.isFalse(isSwap);
    });
  });
});