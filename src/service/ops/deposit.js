'use strict'

const config = require('config')
const {BigNumber: BN} = require('ethers')
const {isRecentTransaction} = require('../recent')
const {getGasPrice, isGasPriceAffordable, getWallet} = require('../../ethers/eth')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {send} = require('../transaction')
const ethers = require('ethers')
const strategyAbi = require('../../abi/strategy.json')
const poolAbi = require('../../abi/pool.json')
const operation = Operation.DEPOSIT_ALL

function getCollateralPercentage(data) {
  let collateralPercentage = config.vesper.depositAll.collateralPercentage
  if (config.vesper[data.operation][data.name] && config.vesper[data.operation][data.name].collateralPercentage) {
    collateralPercentage = config.vesper[data.operation][data.name].collateralPercentage
  }
  return collateralPercentage
}

function isEnoughFundAvailable(data) {
  return getWallet().then(function (wallet) {
    const contract = new ethers.Contract(data.contract.address, poolAbi, wallet.provider)
    const totalValuePromise = contract.totalValue()
    const tokensHerePromise = contract.tokensHere()
    return Promise.all([totalValuePromise, tokensHerePromise]).then(function (values) {
      const totalValue = BN.from(values[0])
      const tokensHere = BN.from(values[1])
      const minimumCollateral = BN.from(
        totalValue
          .mul(BN.from(getCollateralPercentage(data) * 100))
          .div(100)
          .toString()
      )
      return tokensHere.gte(minimumCollateral)
    })
  })
}

async function shouldSkipTheJob(data) {
  return isGasPriceAffordable().then(function (result) {
    if (result) {
      return isEnoughFundAvailable(data).then(function (enoughFund) {
        if (enoughFund) {
          return isRecentTransaction(data)
        }
        return true
      })
    }
    return true
  })
}

function run(data) {
  const priority = config.vesper[data.operation] ? config.vesper[data.operation].priority : config.vesper.priority
  return getGasPrice(data.blockingTxnGasPrice).then(function (gasPrice) {
    const params = {
      pool: data.name,
      nonce: data.nonce,
      operation,
      priority: getPriority(priority),
      gasPrice,
      toAddress: data.strategy.address,
    }
    return getWallet().then(function (wallet) {
      params.fromAddress = wallet.address
      const contract = new ethers.Contract(params.toAddress, strategyAbi, wallet)
      return send(params, contract, params.operation)
    })
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

async function prepare(input) {
  return require('./pool').prepare(input)
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
