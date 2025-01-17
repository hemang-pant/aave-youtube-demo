import { API_ETH_MOCK_ADDRESS, ChainId } from '@aave/contract-helpers';
import { USD_DECIMALS, valueToBigNumber } from '@aave/math-utils';
import { Trans } from '@lingui/macro';
import { Skeleton, Stack, Typography } from '@mui/material';
import BigNumber from 'bignumber.js';
import React, { useEffect, useState } from 'react';
import { WrappedTokenTooltipContent } from 'src/components/infoTooltips/WrappedTokenToolTipContent';
import { FormattedNumber } from 'src/components/primitives/FormattedNumber';
import { TokenIcon } from 'src/components/primitives/TokenIcon';
import { Warning } from 'src/components/primitives/Warning';
import { TextWithTooltip } from 'src/components/TextWithTooltip';
import { AMPLWarning } from 'src/components/Warnings/AMPLWarning';
import { CollateralType } from 'src/helpers/types';
import { useWalletBalances } from 'src/hooks/app-data-provider/useWalletBalances';
import {
  useTokenInForTokenOut,
  useTokenOutForTokenIn,
} from 'src/hooks/token-wrapper/useTokenWrapper';
import { useAssetCaps } from 'src/hooks/useAssetCaps';
import { useModalContext } from 'src/hooks/useModal';
import { useProtocolDataContext } from 'src/hooks/useProtocolDataContext';
import { useWrappedTokens, WrappedTokenConfig } from 'src/hooks/useWrappedTokens';
import { ERC20TokenType } from 'src/libs/web3-data-provider/Web3Provider';
import { useRootStore } from 'src/store/root';
import {
  getMaxAmountAvailableToSupply,
  remainingCap,
} from 'src/utils/getMaxAmountAvailableToSupply';
import { calculateHFAfterSupply } from 'src/utils/hfUtils';
import { isFeatureEnabled } from 'src/utils/marketsAndNetworksConfig';
import { GENERAL } from 'src/utils/mixPanelEvents';
import { roundToTokenDecimals } from 'src/utils/utils';

import {
  ExtendedFormattedUser,
  useAppDataContext,
} from '../../../hooks/app-data-provider/useAppDataProvider';
import { CapType } from '../../caps/helper';
import { Asset, AssetInput } from '../AssetInput';
import { GasEstimationError } from '../FlowCommons/GasEstimationError';
import { ModalWrapperProps } from '../FlowCommons/ModalWrapper';
import { TxSuccessView } from '../FlowCommons/Success';
import {
  DetailsCollateralLine,
  DetailsHFLine,
  DetailsIncentivesLine,
  DetailsNumberLine,
  TxModalDetails,
} from '../FlowCommons/TxModalDetails';
import { getAssetCollateralType } from '../utils';
import { AAVEWarning } from '../Warnings/AAVEWarning';
import { IsolationModeWarning } from '../Warnings/IsolationModeWarning';
import { SNXWarning } from '../Warnings/SNXWarning';
import { SupplyActions } from './SupplyActions';
import { SupplyWrappedTokenActions } from './SupplyWrappedTokenActions';
import { useAllowance, useBalance, useCaIntent, useCaState } from 'src/services/ca';
import { CA } from '@arcana/ca-sdk';
import { current } from 'immer';
import Tooltip from '@visx/tooltip/lib/tooltips/Tooltip';

export enum ErrorType {
  CAP_REACHED,
}

export const SupplyModalContentWrapper = (
  params: ModalWrapperProps & { user: ExtendedFormattedUser }
) => {
  const user = params.user;
  const { currentMarketData } = useProtocolDataContext();
  const wrappedTokenReserves = useWrappedTokens();
  const { walletBalances } = useWalletBalances(currentMarketData);
  const { supplyCap: supplyCapUsage, debtCeiling: debtCeilingUsage } = useAssetCaps();

  const { poolReserve, userReserve } = params;

  const wrappedToken = wrappedTokenReserves.find(
    (r) => r.tokenOut.underlyingAsset === params.underlyingAsset
  );

  const canSupplyAsWrappedToken =
    wrappedToken &&
    walletBalances[wrappedToken.tokenIn.underlyingAsset.toLowerCase()].amount !== '0';

  const hasDifferentCollateral = user.userReservesData.find(
    (reserve) => reserve.usageAsCollateralEnabledOnUser && reserve.reserve.id !== poolReserve.id
  );

  const showIsolationWarning: boolean =
    !user.isInIsolationMode &&
    poolReserve.isIsolated &&
    !hasDifferentCollateral &&
    (userReserve && userReserve.underlyingBalance !== '0'
      ? userReserve.usageAsCollateralEnabledOnUser
      : true);

  const props: SupplyModalContentProps = {
    ...params,
    isolationModeWarning: showIsolationWarning ? (
      <IsolationModeWarning asset={poolReserve.symbol} />
    ) : null,
    addTokenProps: {
      address: poolReserve.aTokenAddress,
      symbol: poolReserve.iconSymbol,
      decimals: poolReserve.decimals,
      aToken: true,
    },
    collateralType: getAssetCollateralType(
      userReserve,
      user.totalCollateralUSD,
      user.isInIsolationMode,
      debtCeilingUsage.isMaxed
    ),
    supplyCapWarning: supplyCapUsage.determineWarningDisplay({ supplyCap: supplyCapUsage }),
    debtCeilingWarning: debtCeilingUsage.determineWarningDisplay({ debtCeiling: debtCeilingUsage }),
    wrappedTokenConfig: wrappedTokenReserves.find(
      (r) => r.tokenOut.underlyingAsset === params.underlyingAsset
    ),
  };



  return canSupplyAsWrappedToken ? (
    <SupplyWrappedTokenModalContent {...props} />
  ) : (
    <SupplyModalContent {...props} />
  );
};

interface SupplyModalContentProps extends ModalWrapperProps {
  addTokenProps: ERC20TokenType;
  collateralType: CollateralType;
  isolationModeWarning: React.ReactNode;
  supplyCapWarning: React.ReactNode;
  debtCeilingWarning: React.ReactNode;
  wrappedTokenConfig?: WrappedTokenConfig;
  user: ExtendedFormattedUser;
}

export const SupplyModalContent = React.memo(
  ({
    underlyingAsset,
    poolReserve,
    isWrongNetwork,
    nativeBalance,
    tokenBalance,
    isolationModeWarning,
    addTokenProps,
    collateralType,
    supplyCapWarning,
    debtCeilingWarning,
    user,
  }: SupplyModalContentProps) => {
    const { marketReferencePriceInUsd } = useAppDataContext();
    const { currentMarketData, currentNetworkConfig } = useProtocolDataContext();
    const {
      mainTxState: supplyTxState,
      gasLimit,
      txError,
      intentTxState,
      allowanceState,
    } = useModalContext();

    const [steps, setSteps] = useState(useCaState());

    // console.log("Steps states: ",steps.steps.find((s) => s.done==true))
    const minRemainingBaseTokenBalance = useRootStore(
      (state) => state.poolComputed.minRemainingBaseTokenBalance
    );


    // states
    const [amount, setAmount] = useState('');
    const supplyUnWrapped = underlyingAsset.toLowerCase() === API_ETH_MOCK_ADDRESS.toLowerCase();

    const walletBalance = supplyUnWrapped ? nativeBalance : tokenBalance;
    const balances = useBalance();
    const supplyApy = poolReserve.supplyAPY;
    const { supplyCap, totalLiquidity, isFrozen, decimals, debtCeiling, isolationModeTotalDebt } =
      poolReserve;

    const allowance = useAllowance().values;
    const valal = useAllowance();

    // Calculate max amount to supply
    const maxAmountToSupply = getMaxAmountAvailableToSupply(
      walletBalance,
      { supplyCap, totalLiquidity, isFrozen, decimals, debtCeiling, isolationModeTotalDebt },
      underlyingAsset,
      minRemainingBaseTokenBalance
    );

    const handleChange = (value: string) => {
      if (value === '-1') {
        setAmount(maxAmountToSupply);
      } else {
        const decimalTruncatedValue = roundToTokenDecimals(value, poolReserve.decimals);
        setAmount(decimalTruncatedValue);
      }
    };

    const amountInEth = new BigNumber(amount).multipliedBy(
      poolReserve.formattedPriceInMarketReferenceCurrency
    );

    const amountInUsd = amountInEth
      .multipliedBy(marketReferencePriceInUsd)
      .shiftedBy(-USD_DECIMALS);

    
    const isMaxSelected = amount === maxAmountToSupply;

    const healfthFactorAfterSupply = calculateHFAfterSupply(user, poolReserve, amountInEth);

    const supplyActionsProps = {
      amountToSupply: amount,
      isWrongNetwork,
      poolAddress: supplyUnWrapped ? API_ETH_MOCK_ADDRESS : poolReserve.underlyingAsset,
      symbol: supplyUnWrapped ? currentNetworkConfig.baseAssetSymbol : poolReserve.symbol,
      blocked: false,
      decimals: poolReserve.decimals,
      isWrappedBaseAsset: poolReserve.isWrappedBaseAsset,
    };

    if (supplyTxState.success)
      return (
        <TxSuccessView
          action={<Trans>Supplied</Trans>}
          amount={amount}
          symbol={supplyUnWrapped ? currentNetworkConfig.baseAssetSymbol : poolReserve.symbol}
          addToken={addTokenProps}
        />
      );

    

    return (
      <>
        {isolationModeWarning}
        {supplyCapWarning}
        {debtCeilingWarning}
        {poolReserve.symbol === 'AMPL' && (
          <Warning sx={{ mt: '16px', mb: '40px' }} severity="warning">
            <AMPLWarning />
          </Warning>
        )}
        {process.env.NEXT_PUBLIC_ENABLE_STAKING === 'true' &&
          poolReserve.symbol === 'AAVE' &&
          isFeatureEnabled.staking(currentMarketData) && <AAVEWarning />}
        {poolReserve.symbol === 'SNX' && maxAmountToSupply !== '0' && <SNXWarning />}

        <AssetInput
          value={amount}
          onChange={handleChange}
          usdValue={amountInUsd.toString(10)}
          symbol={supplyUnWrapped ? currentNetworkConfig.baseAssetSymbol : poolReserve.symbol}
          assets={[
            {
              balance: CA.getSupportedChains().find(
                (chain) => chain.id === currentMarketData.chainId
              )
                ? balances?.find((b) => b.symbol === poolReserve.symbol)?.balance
                : maxAmountToSupply,
              symbol: supplyUnWrapped ? currentNetworkConfig.baseAssetSymbol : poolReserve.symbol,
              iconSymbol: supplyUnWrapped
                ? currentNetworkConfig.baseAssetSymbol
                : poolReserve.iconSymbol,
            },
          ]}
          capType={CapType.supplyCap}
          isMaxSelected={isMaxSelected}
          disabled={supplyTxState.loading || intentTxState.success || intentTxState.loading}
          maxValue={
            CA.getSupportedChains().find((chain) => chain.id === currentMarketData.chainId)
              ? balances?.find(
                  (b) =>
                    b.symbol === poolReserve.symbol ||
                    (poolReserve.symbol === 'WETH' && b.symbol === 'ETH')
                )?.balance
              : maxAmountToSupply
          }
          balanceText={<Trans>Unified token balance</Trans>}
          event={{
            eventName: GENERAL.MAX_INPUT_SELECTION,
            eventParams: {
              asset: poolReserve.underlyingAsset,
              assetName: poolReserve.name,
            },
          }}
        />

        {intentTxState.success && !supplyTxState.success ? (
          // display useCaIntent().intent data in a div
          supplyTxState.loading ? (
            // intent is done, but supply is not done
            steps.steps.map((step, index) => {
              return (
                <div key={index}>
                  <h1>{step.done ? "✅":"⭕"}{' '}{step.type}</h1>
                </div>
              );
            }
            )
          ) : (
            //intent is displayed
            <div>
              <h1>Intent details</h1>
              <h3>
                You Have:
                <div key={"sources"} style={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '10px',
                          margin: '0px',
                          border: '1px solid black',
                          borderRadius: '5px',
                          width: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          backgroundColor: 'hsl(0, 12, 93)',
                          marginTop: '10px',
                          marginBottom: '10px',
                     }}>
                {useCaIntent()?.intent?.sources.map((source, index) => {
                  
                  return (
                    // align source chain name to the left and amount to the right
                      <div key={index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '5px',
                          margin: '0px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <TokenIcon
                            symbol={useCaIntent()?.intent?.token.symbol!}
                            fontSize="large"
                          />
                          <Typography
                            variant="subheader1"
                            sx={{ ml: 2, opacity: 1, fontSize: '1.2rem' }}
                            noWrap
                            data-cy={`assetName`}
                          >
                            {useCaIntent()?.intent?.token.symbol}
                          </Typography>
                          <Typography
                            variant="subheader1"
                            sx={{ ml: 1, opacity: 0.3 }}
                            noWrap
                            data-cy={`assetName`}
                          >
                            {useCaIntent()?.intent?.sources[index].chainName}
                          </Typography>
                        </div>
                        <div></div>
                        <div
                          style={{
                            fontSize: '0.9rem',
                            fontWeight: 'normal',
                          }}
                        >
                          {useCaIntent()?.intent?.sources[index].amount}{' '}
                          {useCaIntent()?.intent?.token.symbol}
                        </div>
                      </div>
                  );
                })}
                <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px',
                      margin: '0px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <TokenIcon symbol={useCaIntent()?.intent?.token.symbol!} fontSize="large" />
                      <Typography
                        variant="subheader1"
                        sx={{ ml: 2, opacity: 1, fontSize: '1.2rem' }}
                        noWrap
                        data-cy={`assetName`}
                      >
                        {useCaIntent()?.intent?.token.symbol}
                      </Typography>
                      <Typography
                        variant="subheader1"
                        sx={{ ml: 1, opacity: 0.3 }}
                        noWrap
                        data-cy={`assetName`}
                      >
                        {useCaIntent()?.intent?.destination.chainName}
                      </Typography>
                    </div>
                    <div></div>
                    <div
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 'normal',
                      }}
                    >
                      {Number(balances?.find(
                        (b) => b.symbol === poolReserve.symbol)?.breakdown.find((b)=>b.chain.id==useCaIntent()?.intent?.destination.chainID!)?.balance)
                      }{' '}
                      {useCaIntent()?.intent?.token.symbol}
                    </div>
                  </div>
                                    </div>
                You Need
                <div style={{ display: 'flex' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px',
                      margin: '0px',
                      border: '1px solid black',
                      borderRadius: '5px',
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      backgroundColor: 'hsl(0, 12, 93)',
                      marginTop: '10px',
                      marginBottom: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <TokenIcon symbol={useCaIntent()?.intent?.token.symbol!} fontSize="large" />
                      <Typography
                        variant="subheader1"
                        sx={{ ml: 2, opacity: 1, fontSize: '1.2rem' }}
                        noWrap
                        data-cy={`assetName`}
                      >
                        {useCaIntent()?.intent?.token.symbol}
                      </Typography>
                      <Typography
                        variant="subheader1"
                        sx={{ ml: 1, opacity: 0.3 }}
                        noWrap
                        data-cy={`assetName`}
                      >
                        {useCaIntent()?.intent?.destination.chainName}
                      </Typography>
                    </div>
                    <div></div>
                    <div
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 'normal',
                      }}
                    >
                      {Number(Number(useCaIntent()?.intent?.sourcesTotal)+Number(
                        balances?.find(
                          (b) => b.symbol === poolReserve.symbol)?.breakdown.find((b)=>b.chain.id==useCaIntent()?.intent?.destination.chainID!)?.balance
                        )-Number(useCaIntent().intent?.fees.total)).toPrecision(10)
                        }{' '}
                      {useCaIntent()?.intent?.token.symbol}
                    </div>
                  </div>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div>Total Fees:</div>
                  <div> </div>
                  <div>
                    {' '}
                    ~{useCaIntent()?.intent?.fees.total} {useCaIntent()?.intent?.token.symbol}
                  </div>
                </div>
                <div key={'fees'} style={{ display: 'flex' }}>
                  <div
                    style={{
                      padding: '10px',
                      margin: '0px',
                      border: '1px solid black',
                      borderRadius: '5px',
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      backgroundColor: 'hsl(0, 12, 93)',
                      marginTop: '10px',
                      marginBottom: '10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>CA Gas Fees:</div>
                      <div> </div>
                      <div>
                        {useCaIntent().intent?.fees.caGas}{' '}
                        {useCaIntent()?.intent?.token.symbol}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>Solver Fees:</div>
                      <div> </div>
                      <div>
                        {useCaIntent().intent?.fees.solver}{' '}
                        {useCaIntent()?.intent?.token.symbol}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>Protocol Fees:</div>
                      <div> </div>
                      <div>
                        {useCaIntent().intent?.fees.protocol}{' '}
                        {useCaIntent()?.intent?.token.symbol}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>Gas Supplied:</div>
                      <div> </div>
                      <div>
                        {useCaIntent()?.intent?.fees?.gasSupplied}{' '}
                        {useCaIntent()?.intent?.token.symbol}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>Total Spend:</div>
                  <div> </div>
                  <div>{
                    Number(Number(useCaIntent()?.intent?.sourcesTotal)+Number(
                      balances?.find(
                        (b) => b.symbol === poolReserve.symbol)?.breakdown.find((b)=>b.chain.id==useCaIntent()?.intent?.destination.chainID!)?.balance
                      )
                      // +Number(useCaIntent()?.intent?.fees.total)
                    ).toPrecision(10)
                    }{' '}{useCaIntent()?.intent?.token.symbol}</div>
                </div>
              </h3>
            </div>
          )
        ) : 
        (allowanceState.success ) 
        // true == true
         ? (
          <div>
            <table style={{
              display: 'flex',
              flexDirection: 'column',
              margin: '0px',
                border: '1px solid black',
                borderRadius: '5px',
                width: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginBottom: '10px',
             }}>
          <thead>
            <tr
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}
            >
              <th
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '15%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>Token</th>
              <th
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                width: '15%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>Chain</th>
              <th
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '25%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>Current Allowance</th>
              <th
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '25%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>Min Allowance</th>
              <th
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '25%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>Set Allowance</th>
            </tr>
          </thead>
          <tbody>
            <tr 
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-evenly',
              }}
            >
              {
                valal.data.map((elem, index) => {
                  return (
                    <tr key={index}>
                      <td
                        style={{
                          justifyContent: 'space-evenly',
                          alignItems: 'center',
                          padding: '5px',
                          width: '5%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          backgroundColor: 'hsl(0, 12, 93)',
                          marginTop: '10px',
                          marginBottom: '10px',
                        }}
                      >{ elem.token.symbol }</td>
              <td
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '15%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}
              >{
                 `${elem.chainName}` }</td>
              <td
              style={{
                justifyContent: 'space-evenly',
                alignItems: 'center',
                padding: '5px',
                width: '25%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>{
                 elem.currentAllowance.toString().startsWith("11579208923731619542") ? "MAX" :
                elem.currentAllowance 
                }</td>
              <td
              style={{

                justifyContent: 'space-between',
                alignItems: 'left',
                padding: '5px',
                width: '25%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backgroundColor: 'hsl(0, 12, 93)',
                marginTop: '10px',
                marginBottom: '10px',
              }}>
                {elem.minAllowance }
              </td>
              <td style={{
                // flexDirection: 'row',
                justifyContent: 'space-evenly',
                alignItems: 'right',
                width: '25%',
                direction: 'rtl',
                paddingRight: '10px',
                }}>
                <input 
                type="string" value="MAX" disabled
                style={{
                  // flexDirection: 'row',
                  justifyContent: 'space-evenly',
                  alignItems: 'center',
                  width: '100%',
                  direction: 'ltr'
                }}
                />
              </td>
                    </tr>
                  )
                }
                )
              }
            </tr>
          </tbody>
        </table>
          </div>
        ) : (
          // nothing is done
          <TxModalDetails gasLimit={gasLimit} skipLoad={true} disabled={Number(amount) === 0}>
            <DetailsNumberLine description={<Trans>Supply APY</Trans>} value={supplyApy} percent />
            <DetailsIncentivesLine
              incentives={poolReserve.aIncentivesData}
              symbol={poolReserve.symbol}
            />
            <DetailsCollateralLine collateralType={collateralType} />
            <DetailsHFLine
              visibleHfChange={!!amount}
              healthFactor={user ? user.healthFactor : '-1'}
              futureHealthFactor={healfthFactorAfterSupply.toString()}
            />
          </TxModalDetails>
        )}

        {txError && <GasEstimationError txError={txError} />}

        <SupplyActions {...supplyActionsProps} />
      </>
    );
  }
);

export const SupplyWrappedTokenModalContent = ({
  poolReserve,
  wrappedTokenConfig,
  isolationModeWarning,
  supplyCapWarning,
  debtCeilingWarning,
  addTokenProps,
  collateralType,
  isWrongNetwork,
  user,
}: SupplyModalContentProps) => {
  const { marketReferencePriceInUsd } = useAppDataContext();
  const { currentMarketData } = useProtocolDataContext();
  const { mainTxState: supplyTxState, gasLimit, txError } = useModalContext();
  const { walletBalances } = useWalletBalances(currentMarketData);
  const minRemainingBaseTokenBalance = useRootStore(
    (state) => state.poolComputed.minRemainingBaseTokenBalance
  );

  if (!wrappedTokenConfig) {
    throw new Error('Wrapped token config is not defined');
  }


  const tokenInBalance = walletBalances[wrappedTokenConfig.tokenIn.underlyingAsset].amount;
  const tokenOutBalance = walletBalances[wrappedTokenConfig.tokenOut.underlyingAsset].amount;

  const assets = [
    {
      balance: tokenInBalance,
      symbol: wrappedTokenConfig.tokenIn.symbol,
      iconSymbol: wrappedTokenConfig.tokenIn.symbol,
      address: wrappedTokenConfig.tokenIn.underlyingAsset,
    },
  ];

  if (tokenOutBalance !== '0') {
    assets.unshift({
      balance: tokenOutBalance,
      symbol: wrappedTokenConfig.tokenOut.symbol,
      iconSymbol: wrappedTokenConfig.tokenOut.symbol,
      address: wrappedTokenConfig.tokenOut.underlyingAsset,
    });
  }

  const [tokenToSupply, setTokenToSupply] = useState<Asset>(assets[0]);
  const [amount, setAmount] = useState('');
  const [convertedTokenInAmount, setConvertedTokenInAmount] = useState<string>('0');
  const { data: exchangeRate } = useTokenInForTokenOut(
    '1',
    poolReserve.decimals,
    wrappedTokenConfig.tokenWrapperAddress
  );

  useEffect(() => {
    if (!exchangeRate) return;
    const convertedAmount = valueToBigNumber(tokenInBalance).multipliedBy(exchangeRate).toString();
    setConvertedTokenInAmount(convertedAmount);
  }, [exchangeRate, tokenInBalance]);

  const { supplyCap, totalLiquidity, isFrozen, decimals, debtCeiling, isolationModeTotalDebt } =
    poolReserve;

  const maxAmountToSupply = getMaxAmountAvailableToSupply(
    tokenOutBalance,
    { supplyCap, totalLiquidity, isFrozen, decimals, debtCeiling, isolationModeTotalDebt },
    poolReserve.underlyingAsset,
    minRemainingBaseTokenBalance
  );

  const tokenOutRemainingSupplyCap = remainingCap(
    poolReserve.supplyCap,
    poolReserve.totalLiquidity
  );

  let maxAmountOfTokenInToSupply = tokenInBalance;
  if (BigNumber(convertedTokenInAmount).isGreaterThan(tokenOutRemainingSupplyCap)) {
    maxAmountOfTokenInToSupply = BigNumber(tokenOutRemainingSupplyCap)
      .dividedBy(exchangeRate || '0')
      .toString();

    maxAmountOfTokenInToSupply = roundToTokenDecimals(
      maxAmountOfTokenInToSupply,
      poolReserve.decimals
    );
  }

  let supplyingWrappedToken = false;
  if (wrappedTokenConfig) {
    supplyingWrappedToken = tokenToSupply.address === wrappedTokenConfig.tokenIn.underlyingAsset;
  }

  const handleChange = (value: string) => {
    if (value === '-1') {
      if (supplyingWrappedToken) {
        setAmount(maxAmountOfTokenInToSupply);
      } else {
        setAmount(maxAmountToSupply);
      }
    } else {
      const decimalTruncatedValue = roundToTokenDecimals(value, poolReserve.decimals);
      setAmount(decimalTruncatedValue);
    }
  };

  const amountInEth = new BigNumber(amount).multipliedBy(
    supplyingWrappedToken
      ? wrappedTokenConfig.tokenIn.formattedPriceInMarketReferenceCurrency
      : poolReserve.formattedPriceInMarketReferenceCurrency
  );

  const amountInUsd = amountInEth.multipliedBy(marketReferencePriceInUsd).shiftedBy(-USD_DECIMALS);

  const isMaxSelected = amount === maxAmountToSupply;

  const healfthFactorAfterSupply = calculateHFAfterSupply(user, poolReserve, amountInEth);

  if (supplyTxState.success) {
    const successModalAmount = supplyingWrappedToken
      ? BigNumber(amount)
          .dividedBy(exchangeRate || '1')
          .toString()
      : amount;

    return (
      <TxSuccessView
        action={<Trans>Supplied</Trans>}
        amount={successModalAmount}
        symbol={poolReserve.symbol}
        addToken={addTokenProps}
      />
    );
  }

  return (
    <>
      {isolationModeWarning}
      {supplyCapWarning}
      {debtCeilingWarning}
      <AssetInput
        value={amount}
        onChange={handleChange}
        usdValue={amountInUsd.toString(10)}
        symbol={tokenToSupply.symbol}
        assets={assets}
        onSelect={setTokenToSupply}
        capType={CapType.supplyCap}
        isMaxSelected={isMaxSelected}
        disabled={supplyTxState.loading}
        balanceText={<Trans>Wallet balance</Trans>}
        event={{
          eventName: GENERAL.MAX_INPUT_SELECTION,
          eventParams: {
            asset: poolReserve.underlyingAsset,
            assetName: poolReserve.name,
          },
        }}
        exchangeRateComponent={
          supplyingWrappedToken && (
            <ExchangeRate
              supplyAmount={amount}
              decimals={poolReserve.decimals}
              tokenWrapperAddress={wrappedTokenConfig.tokenWrapperAddress}
              tokenInSymbol={wrappedTokenConfig.tokenIn.symbol}
              tokenOutSymbol={wrappedTokenConfig.tokenOut.symbol}
            />
          )
        }
      />

      <TxModalDetails gasLimit={gasLimit} skipLoad={true} disabled={Number(amount) === 0}>
        <DetailsNumberLine
          description={<Trans>Supply APY</Trans>}
          value={poolReserve.supplyAPY}
          percent
        />
        <DetailsIncentivesLine
          incentives={poolReserve.aIncentivesData}
          symbol={poolReserve.symbol}
        />
        <DetailsCollateralLine collateralType={collateralType} />
        <DetailsHFLine
          visibleHfChange={!!amount}
          healthFactor={user ? user.healthFactor : '-1'}
          futureHealthFactor={healfthFactorAfterSupply.toString()}
        />
      </TxModalDetails>

      {txError && <GasEstimationError txError={txError} />}
      {supplyingWrappedToken ? (
        <SupplyWrappedTokenActions
          tokenWrapperAddress={wrappedTokenConfig.tokenWrapperAddress}
          tokenIn={wrappedTokenConfig.tokenIn.underlyingAsset}
          amountToSupply={amount}
          decimals={18}
          symbol={wrappedTokenConfig.tokenIn.symbol}
          isWrongNetwork={isWrongNetwork}
        />
      ) : (
        <SupplyActions
          isWrongNetwork={isWrongNetwork}
          amountToSupply={amount}
          poolAddress={poolReserve.underlyingAsset}
          symbol={poolReserve.symbol}
          blocked={false}
          decimals={poolReserve.decimals}
          isWrappedBaseAsset={false}
        />
      )}
    </>
  );
};

const ExchangeRate = ({
  supplyAmount,
  decimals,
  tokenInSymbol,
  tokenOutSymbol,
  tokenWrapperAddress,
}: {
  supplyAmount: string;
  decimals: number;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  tokenWrapperAddress: string;
}) => {
  const { isFetching: loading, data: tokenOutAmount } = useTokenOutForTokenIn(
    supplyAmount,
    decimals,
    tokenWrapperAddress
  );

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Typography variant="caption">Supply amount</Typography>
      <TokenIcon sx={{ fontSize: '16px' }} symbol="sdai" />
      {loading ? (
        <Skeleton variant="rectangular" width={80} height={14} />
      ) : (
        <>
          <FormattedNumber
            value={tokenOutAmount || ''}
            variant="subheader2"
            color="text.primary"
            visibleDecimals={2}
          />
          <Typography variant="subheader2" color="text.secondary">
            sDAI
          </Typography>
        </>
      )}
      <TextWithTooltip>
        <WrappedTokenTooltipContent
          decimals={decimals}
          tokenWrapperAddress={tokenWrapperAddress}
          tokenInSymbol={tokenInSymbol}
          tokenOutSymbol={tokenOutSymbol}
        />
      </TextWithTooltip>
    </Stack>
  );
};
