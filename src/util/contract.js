'use strict'
const axios = require('axios')
const {getDashboardApiUrl} = require('../ethers/eth')
const {getLogger} = require('../util/logger')
const status = 'operative'
const allowedStages = ['prod', 'beta', 'alpha']
const feeCollector = 'Fee Collector'

function getContractMetadata(input = []) {
  const contracts = []
  input.retryCount = input.retryCount ? input.retryCount : 0
  const apiUrl = getDashboardApiUrl()
  return axios
    .get(apiUrl)
    .then(function (response) {
      const pools = input ? input.map(item => item.name) : []
      response.data.pools
        .filter(item =>
          pools.length === 0 || pools[0] === ''
            ? item.status === status && allowedStages.includes(item.stage)
            : pools.includes(item.name) &&
              item.status === status &&
              allowedStages.includes(item.stage) &&
              (item.contract.version === input[0].version || input[0].version === undefined)
        )
        .map(function (item) {
          delete item.poolRewards
          if (item.name !== feeCollector) {
            delete item.tokens
          }
          if (pools.length > 0) {
            const {strategy, operation} = input[0]
            pools.forEach(function (pool) {
              if (pool === item.name) {
                item.operation = operation
              }
            })
            // When `strategy` is provided, filter it out from `strategies`
            if (strategy && item.strategies && item.strategies.length > 0) {
              item.strategies = item.strategies.filter(_strategy => _strategy.info.split(':')[0] === strategy)
            }
          }
          contracts.push(item)
        })
      return contracts
    })
    .catch(function (err) {
      const logger = getLogger()
      if (input.retryCount <= 1 && err.response.status === 504) {
        input.retryCount = input.retryCount + 1        
        logger.warn('Failed to get contract metadata for input %s, Retrying...', JSON.stringify(input))
        return getContractMetadata(input)
      }
      logger.warn('Failed to get contract metadata, give up', input)
      return contracts
    })
}

module.exports = {
  getContractMetadata,
}
