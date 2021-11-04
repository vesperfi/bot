'use strict'

const config = require('config')
const ethers = require('ethers')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
const {send} = require('../transaction')
const {getProvider, getWallet} = require('../../ethers/eth')
const strategyAbi = require('../../abi/strategy.json')
const collateralManagerAbi = require('../../abi/collateralManagerAbi.json')
const operation = Operation.LOW_WATER

async function shouldSkipTheJob(data) {
  return getWallet().then(function (wallet) {
    const strategyContract = new ethers.Contract(data.strategy.address, strategyAbi, wallet)
    return strategyContract.lowWater().then(function (lowWater) {
      return strategyContract.cm().then(function (collateralManager) {
        const cmContract = new ethers.Contract(collateralManager, collateralManagerAbi, wallet)
        return cmContract.getVaultInfo(data.strategy.address).then(function (vaultInfo) {
          return vaultInfo.collateralRatio.eq(0) || vaultInfo.collateralRatio.gt(lowWater)
        })
      })
    })
  })
}

function run(data) {
  const priority = config.vesper[data.operation].priority || config.vesper.priority
  // Strategy is low water, call rebalance operation
  data.operation = Operation.REBALANCE
  return getProvider()
    .getFeeData()
    .then(function (feeData) {
      const params = {
        pool: data.name,
        nonce: data.nonce,
        operation: data.operation,
        priority: getPriority(priority),
        gasPrice: feeData.gasPrice.toString(),
        toAddress: data.strategy.address,
      }
      return getWallet().then(function (wallet) {
        params.fromAddress = wallet.address
        const contract = new ethers.Contract(params.toAddress, strategyAbi, wallet)
        return send(params, contract, Operation.REBALANCE)
      })
    })
}

async function prepare(input) {
  return require('./pool').prepareMakerStrategies(input, module.exports)
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
