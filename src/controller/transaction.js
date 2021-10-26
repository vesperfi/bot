'use strict'
const config = require('config')
const Secret = require('../util/secret')
const secret = new Secret()
const {Status} = require('../enum/status')
const {getStartBlockNumber, getProvider} = require('../ethers/eth')
const {Pool} = require('../enum/pools')
const {getContractMetadata} = require('../util/contract')
const {prepareErrorResponse, prepareResponse} = require('../util/utils')
const vesperPoolAbi = require('../abi/pool.json')
const pSeries = require('p-series')
const ethers = require('ethers')
const ONE_DAY_BLOCK_COUNT = 240 * 24
const BETA_FEE_COLLECTOR_ADDRESS = '0x9520b477Aa81180E6DdC006Fc09Fb6d3eb4e807A'
const VSP_TOKEN_ADDRESS = '0x1b40183efb4dd766f11bda7a7c3ad8982e998421'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const BETA_POOL_PREFIX = 'vBeta'
const DEFAULT_DAYS = 7
const DEFAULT_ERROR_MESSAGE = 'Not able to retrieve transactions. Check logs for more detail.'

function getContractFilter(data) {
  let contractAddress = data.contract.address
  let fromAddress = data.strategy.address
  let toAddress = config.vesper.revenueConfig.address
  if (data.name === Pool.vVSP) {
    contractAddress = VSP_TOKEN_ADDRESS
    toAddress = data.contract.address
  } else if (data.name.includes(BETA_POOL_PREFIX)) {
    toAddress = BETA_FEE_COLLECTOR_ADDRESS
  } else if (data.name === Pool.veETH_DAI) {
    fromAddress = ZERO_ADDRESS
    toAddress = data.strategy.address
    contractAddress = DAI_ADDRESS
  } else {
    fromAddress = ZERO_ADDRESS
    toAddress = data.strategy.address
  }
  const contractObj = new ethers.Contract(contractAddress, vesperPoolAbi, getProvider())
  const filter = contractObj.filters.Transfer(fromAddress, toAddress)
  return {
    contractObj,
    filter,
  }
}

function getRebalanceTransactionsForOneStrategy(data, fromBlock, toBlock = 'latest', strategyMap = []) {
  const {contractObj, filter} = getContractFilter(data)
  const provider = getProvider()
  return contractObj.queryFilter(filter, fromBlock, toBlock).then(function (events) {
    const rebalance = []
    const txnPromises = []
    const blockPromises = []
    events.forEach(function (event) {
      txnPromises.push(provider.getTransactionReceipt(event.transactionHash))
      blockPromises.push(provider.getBlock(event.blockNumber))
    })
    return Promise.all(blockPromises).then(function (blocks) {
      return Promise.all(txnPromises).then(function (txns) {
        let index = 0
        txns.forEach(function (txn) {
          const txnData = {
            transactionHash: txn.transactionHash,
            transactionStatus: txn.status ? Status.SUCCESS : Status.FAILED,
            transactionDate: new Date(blocks[index].timestamp * 1000).toUTCString(),
            toAddress: txn.to,
          }
          if (strategyMap[txn.to]) {
            txnData.strategy = strategyMap[txn.to].info
          }
          rebalance.push(txnData)
          index++
        })
        return rebalance
      })
    })
  })
}

async function getRebalanceTransactions(data, fromBlock, toBlock = 'latest', strategyMap = []) {
  const promises = []
  const result = {}
  result.pool = data.name
  result.address = data.contract.address
  if (data.toAddress) {
    // used in recent transactions
    data.strategy.address = data.toAddress
    promises.push(() => getRebalanceTransactionsForOneStrategy(data, fromBlock, toBlock, strategyMap))
  } else {
    data.strategies.map(function (strategy) {
      const _data = {...data}
      _data.strategy = strategy
      promises.push(() => getRebalanceTransactionsForOneStrategy(_data, fromBlock, toBlock, strategyMap))
    })
  }
  return pSeries(promises).then(function (rebalanceArrays) {
    let txns = []
    rebalanceArrays.forEach(function (rebalanceArray) {
      if (rebalanceArray.length > 0) {
        txns = [...txns, ...rebalanceArray]
      }
    })
    result.rebalance = txns
    return result
  })
}

function getFromBlockNumber(fromBlock, days) {
  if (fromBlock) return new Promise(resolve => resolve(fromBlock))
  return getStartBlockNumber(days * ONE_DAY_BLOCK_COUNT)
}

function prepareStrategiesMap(contracts) {
  const strategyMap = {}
  contracts.map(contractObj =>
    contractObj.strategies.map(strategy => (strategyMap[strategy.address] = {info: strategy.info}))
  )
  return strategyMap
}

function getRebalanceSummary(event) {
  return secret.initSecret().then(function () {
    return getContractMetadata()
      .then(function (contracts) {
        const querystring = event.queryStringParameters
        const days = querystring && querystring.days ? querystring.days : DEFAULT_DAYS
        let _fromBlock = querystring && querystring.fromBlock ? querystring.fromBlock : undefined
        const _toBlock = querystring && querystring.toBlock ? querystring.toBlock : 'latest'
        return getFromBlockNumber(_fromBlock, days).then(function (fromBlock) {
          _fromBlock = fromBlock
          const promises = []
          const strategyMap = prepareStrategiesMap(contracts)
          contracts.map(contractObj =>
            promises.push(() => getRebalanceTransactions(contractObj, _fromBlock, _toBlock, strategyMap))
          )
          return pSeries(promises).then(values => prepareResponse(values))
        })
      })
      .catch(function (error) {
        return prepareErrorResponse(DEFAULT_ERROR_MESSAGE, error)
      })
  })
}

module.exports = {
  getRebalanceSummary,
  getRebalanceTransactions,
}
