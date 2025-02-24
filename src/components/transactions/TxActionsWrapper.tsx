import { CheckIcon } from '@heroicons/react/solid';
import { Trans } from '@lingui/macro';
import { Box, BoxProps, Button, CircularProgress, SvgIcon, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { TxStateType, useModalContext } from 'src/hooks/useModal';
import { useWeb3Context } from 'src/libs/hooks/useWeb3Context';
import { TrackEventProps } from 'src/store/analyticsSlice';
import { TxAction } from 'src/ui-config/errorMapping';
import { ApprovalTooltip } from '../infoTooltips/ApprovalTooltip';
import { RightHelperText } from './FlowCommons/RightHelperText';
import { useAllowance } from 'src/services/ca';
import { useRootStore } from 'src/store/root';
import { API_ETH_MOCK_ADDRESS, ChainId } from '@aave/contract-helpers';
import { normalize } from '@aave/math-utils';
import { useWalletBalances } from 'src/hooks/app-data-provider/useWalletBalances';
import { usePoolReservesHumanized } from 'src/hooks/pool/usePoolReserves';
import { useGasStation } from 'src/hooks/useGasStation';
import { useGasPrice } from 'src/hooks/useGetGasPrices';
import { useIsContractAddress } from 'src/hooks/useIsContractAddress';
import { marketsData } from 'src/ui-config/marketsConfig';
import { getNetworkConfig } from 'src/utils/marketsAndNetworksConfig';
import invariant from 'tiny-invariant';
import { getGasCosts } from './GasStation/GasStation';

interface TxActionsWrapperProps extends BoxProps {
  actionInProgressText: ReactNode;
  actionText: ReactNode;
  intentActionInProgressText?: ReactNode;
  intentActionText?: ReactNode;
  amount?: string;
  approvalTxState?: TxStateType;
  handleApproval?: () => Promise<void>;
  handleAction: () => Promise<void>;
  handleConfirm?: () => void;
  handleAllowance?: () => void;
  isWrongNetwork: boolean;
  mainTxState: TxStateType;
  intentTxState?: TxStateType;
  allowanceTxState?: TxStateType;
  preparingTransactions: boolean;
  requiresAmount?: boolean;
  requiresApproval: boolean;
  requiresAllowance?: boolean;
  symbol?: string;
  blocked?: boolean;
  fetchingData?: boolean;
  errorParams?: {
    loading: boolean;
    disabled: boolean;
    content: ReactNode;
    handleClick: () => Promise<void>;
  };
  tryPermit?: boolean;
  event?: TrackEventProps;
}

export const TxActionsWrapper = ({
  actionInProgressText,
  actionText,
  amount,
  approvalTxState,
  handleApproval,
  intentActionInProgressText,
  handleAction,
  handleConfirm,
  handleAllowance,
  isWrongNetwork,
  mainTxState,
  intentTxState,
  allowanceTxState,
  preparingTransactions,
  intentActionText,
  requiresAmount,
  requiresApproval,
  requiresAllowance,
  sx,
  symbol,
  blocked,
  fetchingData = false,
  errorParams,
  tryPermit,
  event,
  ...rest
}: TxActionsWrapperProps) => {
  const { txError } = useModalContext();
  const { readOnlyModeAddress } = useWeb3Context();
  const hasApprovalError =
    requiresApproval && txError?.txAction === TxAction.APPROVAL && txError?.actionBlocked;
  const isAmountMissing = requiresAmount && requiresAmount && Number(amount) === 0;
      const [currentChainId] = useRootStore((store) => [store.currentChainId, store.account]);
      const selectedChainId = currentChainId;
      // TODO: find a better way to query base token price instead of using a random market.
      const marketOnNetwork = Object.values(marketsData).find(
        (elem) => elem.chainId === selectedChainId
      );
      invariant(marketOnNetwork, 'No market for this network');
      const { walletBalances } = useWalletBalances(marketOnNetwork);
      const nativeBalanceUSD = walletBalances[API_ETH_MOCK_ADDRESS.toLowerCase()]?.amountUSD;    
  let go = true;
  {
    //check if allowance is there
  }
  if(requiresApproval && Number(nativeBalanceUSD)>0){
    go = true;
  }
  else{
    go = false;
  }


  function getMainParams() {
    if (blocked) return { disabled: true, content: actionText };
    if (
      (txError?.txAction === TxAction.GAS_ESTIMATION ||
        txError?.txAction === TxAction.MAIN_ACTION) &&
      txError?.actionBlocked
    ) {
      if (errorParams) return errorParams;
      return { loading: false, disabled: true, content: actionText };
    }
    if (isWrongNetwork) return { disabled: true, content: <Trans>Wrong Network</Trans> };
    if (fetchingData) return { disabled: true, content: <Trans>Fetching data...</Trans> };
    if (isAmountMissing) return { disabled: true, content: <Trans>Enter an amount</Trans> };
    if (preparingTransactions) return { disabled: true, loading: true };
    // if (hasApprovalError && handleRetry)
    //   return { content: <Trans>Retry with approval</Trans>, handleClick: handleRetry };
    if (mainTxState?.loading)
      return { loading: true, disabled: true, content: actionInProgressText };
    if (go && !approvalTxState?.success)
      return { disabled: true, content: actionText };
    if (intentTxState?.loading)
      return { loading: true, disabled: true, content: intentActionInProgressText };
    if(allowanceTxState?.success){
      return { loading: false,disabled: false, content: "Allowance to Arcana Vault", handleClick: handleAllowance };
    }
    if(allowanceTxState?.loading && !allowanceTxState?.success && !intentTxState?.success){
      console.log("success");
      return {loading: true, disabled: true, content: "Verifying Allowance"};
    }
      
    if (intentTxState?.success && !mainTxState?.success && (!go || approvalTxState?.success))
      return {loading: false, disabled:false, content: intentActionText, handleClick: handleConfirm};
    return { content: actionText, handleClick: handleAction };
  }
  function getApprovalParams() {
    if (
      isWrongNetwork ||
      isAmountMissing ||
      preparingTransactions ||
      hasApprovalError || !go
    )
      return null;
    if (approvalTxState?.loading)
      return { loading: true, disabled: true, content: <Trans>Approving {symbol}...</Trans> };
    if (approvalTxState?.success)
      return {
        disabled: true,
        content: (
          <>
            <Trans>Approve Confirmed</Trans>
            <SvgIcon sx={{ fontSize: 20, ml: 2 }}>
              <CheckIcon />
            </SvgIcon>
          </>
        ),
      };

    return {
      content: (
        <ApprovalTooltip
          variant="buttonL"
          iconSize={20}
          iconMargin={2}
          color="white"
          text={<Trans>Approve {symbol} to continue</Trans>}
        />
      ),
      handleClick: handleApproval,
    };
  }

  const { content, disabled, loading, handleClick } = getMainParams();
  const approvalParams = getApprovalParams();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', mt: 12, ...sx }} {...rest}>
      {/* {approvalParams && !readOnlyModeAddress && (
        <Box sx={{ display: 'flex', justifyContent: 'end', alignItems: 'center' }}>
          <RightHelperText approvalHash={approvalTxState?.txHash} tryPermit={tryPermit} />
        </Box>
      )} */}

      {approvalParams && !readOnlyModeAddress && (
        <Button
          variant="contained"
          disabled={approvalParams.disabled || blocked}
          onClick={() => approvalParams.handleClick && approvalParams.handleClick()}
          size="large"
          sx={{ minHeight: '44px' }}
          data-cy="approvalButton"
        >
          {approvalParams.loading && (
            <CircularProgress color="inherit" size="16px" sx={{ mr: 2 }} />
          )}
          {approvalParams.content}
        </Button>
      )}

      <Button
        variant="contained"
        disabled={disabled || blocked || readOnlyModeAddress !== undefined}
        onClick={handleClick}
        size="large"
        sx={{ minHeight: '44px', ...(approvalParams ? { mt: 2 } : {}) }}
        data-cy="actionButton"
      >
        {loading && <CircularProgress color="inherit" size="16px" sx={{ mr: 2 }} />}
        {content}
      </Button>
      {readOnlyModeAddress && (
        <Typography variant="helperText" color="warning.main" sx={{ textAlign: 'center', mt: 2 }}>
          <Trans>Read-only mode. Connect to a wallet to perform transactions.</Trans>
        </Typography>
      )}
    </Box>
  );
};
