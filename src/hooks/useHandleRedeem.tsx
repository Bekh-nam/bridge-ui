import {
  ChainId,
  CHAIN_ID_ALGORAND,
  CHAIN_ID_APTOS,
  CHAIN_ID_INJECTIVE,
  CHAIN_ID_KLAYTN,
  CHAIN_ID_NEAR,
  CHAIN_ID_SOLANA,
  CHAIN_ID_XPLA,
  isEVMChain,
  isTerraChain,
  postVaaSolanaWithRetry,
  redeemAndUnwrapOnSolana,
  redeemOnAlgorand,
  redeemOnEth,
  redeemOnEthNative,
  redeemOnInjective,
  redeemOnSolana,
  redeemOnTerra,
  redeemOnXpla,
  TerraChainId,
  uint8ArrayToHex,
} from "@certusone/wormhole-sdk";
import { completeTransferAndRegister } from "@certusone/wormhole-sdk/lib/esm/aptos/api/tokenBridge";
import { Alert } from "@material-ui/lab";
import { Wallet } from "@near-wallet-selector/core";
import { Connection } from "@solana/web3.js";
import {
  ConnectedWallet,
  useConnectedWallet,
} from "@terra-money/wallet-provider";
import algosdk from "algosdk";
import axios from "axios";
import { Signer } from "ethers";
import { useSnackbar } from "notistack";
import { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAlgorandWallet } from "../contexts/AlgorandWalletContext";
import { useAptosContext } from "../contexts/AptosWalletContext";
import { useEthereumProvider } from "../contexts/EthereumProviderContext";
import { useNearContext } from "../contexts/NearWalletContext";
import { useSolanaWallet } from "../contexts/SolanaWalletContext";
import {
  selectTerraFeeDenom,
  selectTransferIsRedeeming,
  selectTransferTargetChain,
} from "../store/selectors";
import { setIsRedeeming, setRedeemTx } from "../store/transferSlice";
import { signSendAndConfirmAlgorand } from "../utils/algorand";
import {
  getAptosClient,
  waitForSignAndSubmitTransaction,
} from "../utils/aptos";
import {
  ACALA_RELAY_URL,
  ALGORAND_BRIDGE_ID,
  ALGORAND_HOST,
  ALGORAND_TOKEN_BRIDGE_ID,
  getTokenBridgeAddressForChain,
  MAX_VAA_UPLOAD_RETRIES_SOLANA,
  NEAR_TOKEN_BRIDGE_ACCOUNT,
  SOLANA_HOST,
  SOL_BRIDGE_ADDRESS,
  SOL_TOKEN_BRIDGE_ADDRESS,
} from "../utils/consts";
import {
  makeNearAccount,
  redeemOnNear,
  signAndSendTransactions,
} from "../utils/near";
import parseError from "../utils/parseError";
import { signSendAndConfirm } from "../utils/solana";
import { postWithFees } from "../utils/terra";
import useTransferSignedVAA from "./useTransferSignedVAA";
import {
  useConnectedWallet as useXplaConnectedWallet,
  ConnectedWallet as XplaConnectedWallet,
} from "@xpla/wallet-provider";
import { postWithFeesXpla } from "../utils/xpla";
import { broadcastInjectiveTx } from "../utils/injective";
import { useInjectiveContext } from "../contexts/InjectiveWalletContext";
import { AlgorandWallet } from "@xlabs-libs/wallet-aggregator-algorand";
import { SolanaWallet } from "@xlabs-libs/wallet-aggregator-solana";
import { AptosWallet } from "@xlabs-libs/wallet-aggregator-aptos";
import { InjectiveWallet } from "@xlabs-libs/wallet-aggregator-injective";

async function algo(
  dispatch: any,
  enqueueSnackbar: any,
  wallet: AlgorandWallet,
  signedVAA: Uint8Array
) {
  dispatch(setIsRedeeming(true));
  try {
    const algodClient = new algosdk.Algodv2(
      ALGORAND_HOST.algodToken,
      ALGORAND_HOST.algodServer,
      ALGORAND_HOST.algodPort
    );
    const txs = await redeemOnAlgorand(
      algodClient,
      ALGORAND_TOKEN_BRIDGE_ID,
      ALGORAND_BRIDGE_ID,
      signedVAA,
      wallet.getAddress()!
    );
    const result = await signSendAndConfirmAlgorand(wallet, algodClient, txs);
    // TODO: fill these out correctly
    dispatch(
      setRedeemTx({
        id: txs[txs.length - 1].tx.txID(),
        block: result["confirmed-round"],
      })
    );
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function aptos(
  dispatch: any,
  enqueueSnackbar: any,
  signedVAA: Uint8Array,
  wallet: AptosWallet
) {
  dispatch(setIsRedeeming(true));
  const tokenBridgeAddress = getTokenBridgeAddressForChain(CHAIN_ID_APTOS);
  try {
    const msg = await completeTransferAndRegister(
      getAptosClient(),
      tokenBridgeAddress,
      signedVAA
    );
    msg.arguments[0] = Array.from(msg.arguments[0]);
    const result = await waitForSignAndSubmitTransaction(msg, wallet);
    dispatch(setRedeemTx({ id: result, block: 1 }));
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function evm(
  dispatch: any,
  enqueueSnackbar: any,
  signer: Signer,
  signedVAA: Uint8Array,
  isNative: boolean,
  chainId: ChainId
) {
  dispatch(setIsRedeeming(true));
  try {
    // Klaytn requires specifying gasPrice
    const overrides =
      chainId === CHAIN_ID_KLAYTN
        ? { gasPrice: (await signer.getGasPrice()).toString() }
        : {};
    const receipt = isNative
      ? await redeemOnEthNative(
          getTokenBridgeAddressForChain(chainId),
          signer,
          signedVAA,
          overrides
        )
      : await redeemOnEth(
          getTokenBridgeAddressForChain(chainId),
          signer,
          signedVAA,
          overrides
        );
    dispatch(
      setRedeemTx({ id: receipt.transactionHash, block: receipt.blockNumber })
    );
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function near(
  dispatch: any,
  enqueueSnackbar: any,
  senderAddr: string,
  signedVAA: Uint8Array,
  wallet: Wallet
) {
  dispatch(setIsRedeeming(true));
  try {
    const account = await makeNearAccount(senderAddr);
    const msgs = await redeemOnNear(
      account,
      NEAR_TOKEN_BRIDGE_ACCOUNT,
      signedVAA
    );
    const receipt = await signAndSendTransactions(account, wallet, msgs);
    dispatch(
      setRedeemTx({
        id: receipt.transaction_outcome.id,
        block: 0,
      })
    );
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function xpla(
  dispatch: any,
  enqueueSnackbar: any,
  wallet: XplaConnectedWallet,
  signedVAA: Uint8Array
) {
  dispatch(setIsRedeeming(true));
  try {
    const msg = await redeemOnXpla(
      getTokenBridgeAddressForChain(CHAIN_ID_XPLA),
      wallet.xplaAddress,
      signedVAA
    );
    const result = await postWithFeesXpla(
      wallet,
      [msg],
      "Wormhole - Complete Transfer"
    );
    dispatch(
      setRedeemTx({ id: result.result.txhash, block: result.result.height })
    );
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function injective(
  dispatch: any,
  enqueueSnackbar: any,
  wallet: InjectiveWallet,
  walletAddress: string,
  signedVAA: Uint8Array
) {
  dispatch(setIsRedeeming(true));
  try {
    const msg = await redeemOnInjective(
      getTokenBridgeAddressForChain(CHAIN_ID_INJECTIVE),
      walletAddress,
      signedVAA
    );
    const tx = await broadcastInjectiveTx(
      wallet,
      walletAddress,
      msg,
      "Wormhole - Complete Transfer"
    );
    dispatch(setRedeemTx({ id: tx.txHash, block: tx.height }));
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function solana(
  dispatch: any,
  enqueueSnackbar: any,
  wallet: SolanaWallet,
  payerAddress: string, //TODO: we may not need this since we have wallet
  signedVAA: Uint8Array,
  isNative: boolean
) {
  dispatch(setIsRedeeming(true));
  try {
    if (!wallet.signTransaction) {
      throw new Error("wallet.signTransaction is undefined");
    }
    const connection = new Connection(SOLANA_HOST, "confirmed");
    await postVaaSolanaWithRetry(
      connection,
      wallet.signTransaction.bind(wallet),
      SOL_BRIDGE_ADDRESS,
      payerAddress,
      Buffer.from(signedVAA),
      MAX_VAA_UPLOAD_RETRIES_SOLANA
    );
    // TODO: how do we retry in between these steps
    const transaction = isNative
      ? await redeemAndUnwrapOnSolana(
          connection,
          SOL_BRIDGE_ADDRESS,
          SOL_TOKEN_BRIDGE_ADDRESS,
          payerAddress,
          signedVAA
        )
      : await redeemOnSolana(
          connection,
          SOL_BRIDGE_ADDRESS,
          SOL_TOKEN_BRIDGE_ADDRESS,
          payerAddress,
          signedVAA
        );
    const txid = await signSendAndConfirm(wallet, transaction);
    // TODO: didn't want to make an info call we didn't need, can we get the block without it by modifying the above call?
    dispatch(setRedeemTx({ id: txid, block: 1 }));
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

async function terra(
  dispatch: any,
  enqueueSnackbar: any,
  wallet: ConnectedWallet,
  signedVAA: Uint8Array,
  feeDenom: string,
  chainId: TerraChainId
) {
  dispatch(setIsRedeeming(true));
  try {
    const msg = await redeemOnTerra(
      getTokenBridgeAddressForChain(chainId),
      wallet.terraAddress,
      signedVAA
    );
    const result = await postWithFees(
      wallet,
      [msg],
      "Wormhole - Complete Transfer",
      [feeDenom],
      chainId
    );
    dispatch(
      setRedeemTx({ id: result.result.txhash, block: result.result.height })
    );
    enqueueSnackbar(null, {
      content: <Alert severity="success">Transaction confirmed</Alert>,
    });
  } catch (e) {
    enqueueSnackbar(null, {
      content: <Alert severity="error">{parseError(e)}</Alert>,
    });
    dispatch(setIsRedeeming(false));
  }
}

export function useHandleRedeem() {
  const dispatch = useDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const targetChain = useSelector(selectTransferTargetChain);
  const { publicKey: solPK, wallet: solanaWallet } = useSolanaWallet();
  const { signer } = useEthereumProvider(targetChain);
  const terraWallet = useConnectedWallet();
  const terraFeeDenom = useSelector(selectTerraFeeDenom);
  const xplaWallet = useXplaConnectedWallet();
  const { address: algoAccount, wallet: algoWallet } = useAlgorandWallet();
  const { accountId: nearAccountId, wallet } = useNearContext();
  const { account: aptosAddress, wallet: aptosWallet } = useAptosContext();
  const { wallet: injWallet, address: injAddress } = useInjectiveContext();
  const signedVAA = useTransferSignedVAA();
  const isRedeeming = useSelector(selectTransferIsRedeeming);
  const handleRedeemClick = useCallback(() => {
    if (isEVMChain(targetChain) && !!signer && signedVAA) {
      evm(dispatch, enqueueSnackbar, signer, signedVAA, false, targetChain);
    } else if (
      targetChain === CHAIN_ID_SOLANA &&
      !!solanaWallet &&
      !!solPK &&
      signedVAA
    ) {
      solana(dispatch, enqueueSnackbar, solanaWallet, solPK, signedVAA, false);
    } else if (isTerraChain(targetChain) && !!terraWallet && signedVAA) {
      terra(
        dispatch,
        enqueueSnackbar,
        terraWallet,
        signedVAA,
        terraFeeDenom,
        targetChain
      );
    } else if (targetChain === CHAIN_ID_XPLA && !!xplaWallet && signedVAA) {
      xpla(dispatch, enqueueSnackbar, xplaWallet, signedVAA);
    } else if (targetChain === CHAIN_ID_APTOS && !!aptosAddress && signedVAA) {
      aptos(dispatch, enqueueSnackbar, signedVAA, aptosWallet!);
    } else if (
      targetChain === CHAIN_ID_ALGORAND &&
      algoAccount &&
      !!signedVAA
    ) {
      algo(dispatch, enqueueSnackbar, algoWallet, signedVAA);
    } else if (
      targetChain === CHAIN_ID_NEAR &&
      nearAccountId &&
      wallet &&
      !!signedVAA
    ) {
      near(dispatch, enqueueSnackbar, nearAccountId, signedVAA, wallet);
    } else if (
      targetChain === CHAIN_ID_INJECTIVE &&
      injWallet &&
      injAddress &&
      signedVAA
    ) {
      injective(dispatch, enqueueSnackbar, injWallet, injAddress, signedVAA);
    }
  }, [
    dispatch,
    enqueueSnackbar,
    targetChain,
    signer,
    signedVAA,
    solanaWallet,
    solPK,
    terraWallet,
    terraFeeDenom,
    algoAccount,
    algoWallet,
    nearAccountId,
    wallet,
    xplaWallet,
    aptosAddress,
    aptosWallet,
    injWallet,
    injAddress,
  ]);

  const handleRedeemNativeClick = useCallback(() => {
    if (isEVMChain(targetChain) && !!signer && signedVAA) {
      evm(dispatch, enqueueSnackbar, signer, signedVAA, true, targetChain);
    } else if (
      targetChain === CHAIN_ID_SOLANA &&
      !!solanaWallet &&
      !!solPK &&
      signedVAA
    ) {
      solana(dispatch, enqueueSnackbar, solanaWallet, solPK, signedVAA, true);
    } else if (isTerraChain(targetChain) && !!terraWallet && signedVAA) {
      terra(
        dispatch,
        enqueueSnackbar,
        terraWallet,
        signedVAA,
        terraFeeDenom,
        targetChain
      ); //TODO isNative = true
    } else if (
      targetChain === CHAIN_ID_ALGORAND &&
      algoAccount &&
      !!signedVAA
    ) {
      algo(dispatch, enqueueSnackbar, algoWallet, signedVAA);
    } else if (
      targetChain === CHAIN_ID_INJECTIVE &&
      injWallet &&
      injAddress &&
      signedVAA
    ) {
      injective(dispatch, enqueueSnackbar, injWallet, injAddress, signedVAA);
    }
  }, [
    dispatch,
    enqueueSnackbar,
    targetChain,
    signer,
    signedVAA,
    solanaWallet,
    solPK,
    terraWallet,
    terraFeeDenom,
    algoAccount,
    algoWallet,
    injWallet,
    injAddress,
  ]);

  const handleAcalaRelayerRedeemClick = useCallback(async () => {
    if (!signedVAA) return;

    dispatch(setIsRedeeming(true));

    try {
      const res = await axios.post(ACALA_RELAY_URL, {
        targetChain,
        signedVAA: uint8ArrayToHex(signedVAA),
      });

      dispatch(
        setRedeemTx({
          id: res.data.transactionHash,
          block: res.data.blockNumber,
        })
      );
      enqueueSnackbar(null, {
        content: <Alert severity="success">Transaction confirmed</Alert>,
      });
    } catch (e) {
      enqueueSnackbar(null, {
        content: <Alert severity="error">{parseError(e)}</Alert>,
      });
      dispatch(setIsRedeeming(false));
    }
  }, [targetChain, signedVAA, enqueueSnackbar, dispatch]);

  return useMemo(
    () => ({
      handleNativeClick: handleRedeemNativeClick,
      handleClick: handleRedeemClick,
      handleAcalaRelayerRedeemClick,
      disabled: !!isRedeeming,
      showLoader: !!isRedeeming,
    }),
    [
      handleRedeemClick,
      isRedeeming,
      handleRedeemNativeClick,
      handleAcalaRelayerRedeemClick,
    ]
  );
}
