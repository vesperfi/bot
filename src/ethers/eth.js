'use strict'
const config = require('config')
const ethers = require('ethers')
const Secret = require('../util/secret')
const Wallet = ethers.Wallet
const {BigNumber: BN} = require('ethers')
const {getLogger} = require('../util/logger')
const {Status} = require('../enum/status')
const {Env} = require('../enum/env')
const {Network, FORK_ETH_URL} = require('../enum/network')
const vesperERC20TokenAbi = require('../abi/ERC20Abi.json')

function getNetwork() {
  return process.env.NETWORK === Network.POLYGON ? Network.POLYGON : Network.ETHEREUM
}

function isPolygon() {
  return getNetwork() === Network.POLYGON
}

function getChainId() {
  return getNetwork() === Network.POLYGON ? 137 : 1
}

function getDashboardApiUrl() {
  return getNetwork() === Network.POLYGON ? config.vesper.polygonDashboardApiUrl : config.vesper.dashboardApiUrl
}

function getNetworkUrl() {
  if (process.env.STAGE === Env.DEV) {
    return FORK_ETH_URL
  }
  if (getNetwork() === Network.POLYGON) {
    return process.env.POLYGON_NODE_URL
  }
  return process.env.NODE_URL
}

function getProvider() {
  return new ethers.providers.JsonRpcProvider(getNetworkUrl())
}

function createWallet(mnemonic) {
  const walletMnemonic = Wallet.fromMnemonic(mnemonic)
  return walletMnemonic.connect(getProvider())
}

async function getWallet(isFlashbotWallet = false) {
  if (isFlashbotWallet) {
    return new Secret().initFlashbotSecret().then(function () {
      return createWallet(process.env.MNEMONIC)
    })
  }
  return createWallet(process.env.MNEMONIC)
}

function getGasPrice(blockingTxnGasPrice = 0) {
  let gasPrice = 0
  return getProvider()
    .getFeeData()
    .then(function (feeData) {
      gasPrice = BN.from(feeData.gasPrice)
        .mul(BN.from(100 + config.vesper.gasPriceVariationPercentage))
        .div(100)
        .toString()

      if (BN.from(gasPrice).lte(BN.from(blockingTxnGasPrice))) {
        gasPrice = BN.from(gasPrice)
          .mul(BN.from(100 + config.vesper.gasPriceVariationPercentage))
          .div(100)
          .toString()
      }
      return gasPrice
    })
}

function isGasPriceAffordable() {
  return getGasPrice().then(function (gasPrice) {
    if (BN.from(gasPrice).gt(BN.from(config.vesper.ignoreTxnAboveGasPrice).mul(1000000000))) {
      const logger = getLogger()
      logger.warn('Ignoring operation due to high gas price : %s ', gasPrice)
      return false
    }
    return true
  })
}

function getStartBlockNumber(_blockCount) {
  let blockCount = _blockCount
  // polygon / alchemy support max 2000 blocks, keeping last 1900 as upper limit.
  if (blockCount > 1900 && getNetwork() === Network.POLYGON) {
    blockCount = 1900
  }
  return getProvider()
    .getBlockNumber()
    .then(function (latestBlockNumber) {
      return BN.from(latestBlockNumber).sub(BN.from(blockCount)).toNumber()
    })
}

function getTxnStatusFromChain(transactionHash) {
  return getProvider()
    .getTransactionReceipt(transactionHash)
    .then(function (ethTransaction) {
      if (ethTransaction) {
        if (ethTransaction.status) return Status.SUCCESS
        else if (!ethTransaction.status) return Status.FAILED
      }
      return Status.PENDING
    })
}

async function getBalance(erc20Token, address) {
  return new ethers.Contract(erc20Token, vesperERC20TokenAbi, getProvider()).balanceOf(address)
}

module.exports = {
  getNetwork,
  getChainId,
  isPolygon,
  getDashboardApiUrl,
  getProvider,
  getWallet,
  getGasPrice,
  getTxnStatusFromChain,
  getStartBlockNumber,
  isGasPriceAffordable,
  getBalance,
}
