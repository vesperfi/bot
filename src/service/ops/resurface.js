'use strict'

const config = require('config')
const ethers = require('ethers')
const {isRecentTransaction} = require('../recent')
const {getPriority} = require('../../enum/priority')
const {Operation} = require('../../enum/operation')
// const {send} = require('../transaction')
const {getProvider} = require('../../ethers/eth')
const {getWallet} = require('../../ethers/eth')
const strategyAbi = require('../../abi/strategy.json')
const {getLogger} = require('../../util/logger')

const operation = Operation.RESURFACE
const skipPoolFromResurface = 'veETH-DAI'

function isUnderwater(data) {
  const contract = new ethers.Contract(data.strategy.address, strategyAbi, getProvider())
  return contract.isUnderwater()
}

async function shouldSkipTheJob(data) {
  return isUnderwater(data).then(function (result) {
    const logger = getLogger()
    if (result) {
      if (skipPoolFromResurface === data.name) {
        logger.warn(
          'Underwater alert: Strategy: %s (%s), pool: %s (%s) is underwater, Check if manual resurface is needed.',
          data.strategy.info,
          data.strategy.address,
          data.name,
          data.contract.address
        )
        return true
      }
      return isRecentTransaction(data)
    }
    logger.info('Pool : %s is not underwater, skipping resurface operation', data.name)
    return true
  })
}

function run(data) {
  const priority = config.vesper[data.operation].priority || config.vesper.priority
  return getProvider()
    .getFeeData()
    .then(function (feeData) {
      const params = {
        pool: data.name,
        nonce: data.nonce,
        operation,
        priority: getPriority(priority),
        gasPrice: feeData.gasPrice.toString(),
        toAddress: data.strategy.address,
      }
      return getWallet().then(function (wallet) {
        params.fromAddress = wallet.address
        // TODO Temp commented
        // const contract = new ethers.Contract(params.toAddress, strategyAbi, wallet)
        // return send(params, contract, params.operation)
        return data
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
  // TODO Temp commented
  // return require('./pool').after(data)
  return data
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
