/* eslint-disable consistent-return */
'use strict'

const config = require('config')
const ethers = require('ethers')
const {getGasPrice, getWallet} = require('../../ethers/eth')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {isRecentTransaction} = require('../recent')
const revenueConfig = config.get('vesper.revenueConfig')
const {send} = require('../transaction')
const splitRevenueAbi = require('../../abi/splitRevenue.json')
const vesperERC20TokenAbi = require('../../abi/ERC20Abi.json')
const {BigNumber: BN} = require('ethers')
const operation = Operation.SPLIT_REVENUE_ERC20

function calculateRevenue(toAddress, payeeAddress, assetAddress) {
  let revenueForPayee = 0
  return getWallet().then(function (wallet) {
    const contract = new ethers.Contract(toAddress, splitRevenueAbi, wallet.provider)
    const totalSharePromise = contract.totalShare()
    const totalReleasedPromise = contract.totalReleased(assetAddress)
    const sharePromise = contract.share(payeeAddress)
    const releasedPromise = contract.released(payeeAddress, assetAddress)
    return Promise.all([totalSharePromise, totalReleasedPromise, sharePromise, releasedPromise]).then(function ([
      totalShareValue,
      totalReleasedValue,
      shareValue,
      releasedValue,
    ]) {
      return new ethers.Contract(assetAddress, vesperERC20TokenAbi, wallet.provider)
        .balanceOf(toAddress)

        .then(function (tokenBalance) {
          const totalReceived = BN.from(tokenBalance).add(BN.from(totalReleasedValue))
          revenueForPayee = totalReceived
            .mul(BN.from(shareValue))
            .div(BN.from(totalShareValue))
            .sub(BN.from(releasedValue))
          return revenueForPayee
        })
    })
  })
}

function isEnoughFundAvailable(data) {
  const {toAddress, payeeAddress, assetAddress, minBalance} = data
  return calculateRevenue(toAddress, payeeAddress, assetAddress).then(function (payeeRevenue) {
    return BN.from(minBalance).lte(payeeRevenue)
  })
}

function getPayeesAddress(contractAddress) {
  return getWallet().then(function (wallet) {
    const contract = new ethers.Contract(contractAddress, splitRevenueAbi, wallet.provider)
    const promises = []
    for (let index = 0; index < revenueConfig.payeeCount; index++) {
      promises.push(contract.payees(index))
    }
    return Promise.all(promises)
  })
}

async function shouldSkipTheJob(data) {
  return Promise.all([isRecentTransaction(data), isEnoughFundAvailable(data)]).then(function ([
    isRecent,
    enoughBalance,
  ]) {
    return isRecent || !enoughBalance
  })
}

function run(data) {
  const priority = config.vesper[data.operation] ? config.vesper[data.operation].priority : config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name || data.pool,
      nonce: data.nonce,
      priority: getPriority(priority),
      gasPrice,
      operation: data.operation,
      toAddress: data.toAddress,
      payeeAddress: data.payeeAddress,
      assetAddress: data.assetAddress,
      isBlockingTxn: !!data.blockingTxnGasPrice,
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      const contract = new ethers.Contract(data.toAddress, splitRevenueAbi, wallet)
      const methodArgs = [data.payeeAddress, data.assetAddress]
      return send(params, contract, 'release', methodArgs)
    })
  })
}

function prepare() {
  return getPayeesAddress(revenueConfig.address).then(function (payeesAddresses) {
    const data = []
    for (const payeeAddress of payeesAddresses) {
      if (revenueConfig.parties.includes(payeeAddress)) {
        for (const token of revenueConfig.tokens) {
          data.push({
            operationObj: module.exports,
            toAddress: revenueConfig.address,
            operation: Operation.SPLIT_REVENUE_ERC20,
            payeeAddress,
            assetAddress: token.address,
            name: token.symbol,
            minBalance: token.minBalance,
          })
        }
      }
    }
    return data
  })
}

async function before(data) {
  return require('./pool').before(data)
}

async function after(data) {
  return require('./pool').after(data)
}

async function error(data, _error) {
  return require('./pool').error(data, _error)
}

async function executeJob(_data) {
  return before(_data).then(function (data) {
    return run(data)
      .then(function () {
        return after(data)
      })
      .catch(function (_error) {
        return error(data, _error)
      })
  })
}

module.exports = {
  prepare,
  executeJob,
  shouldSkipTheJob,
  operation,
}
