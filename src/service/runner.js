'use strict'

const pSeries = require('p-series')
const {getLogger} = require('../util/logger')
const {Status} = require('../enum/status')
const {Network} = require('../enum/network')
const {getNetwork} = require('../ethers/eth')

async function executeJob(data) {
  data.result = Status.SKIPPED
  const network = getNetwork()
  // Flashbot supported only for ETHEREUM network.
  if (data.sendViaFlashBots && network !== Network.ETHEREUM) {
    data.result = Status.SKIPPED
    return data
  }
  return data.operationObj.shouldSkipTheJob(data).then(function (skip) {
    const logger = getLogger()
    const addOnInfo = data.addOnInfo ? data.addOnInfo : ''
    logger.info(
      'Name: %s, Operation: %s, Skip: %s, Network: %s, %s',
      data.name,
      data.operation ? data.operation : data.operationObj.operation,
      skip,
      network,
      addOnInfo
    )
    if (!skip) {
      return data.operationObj.executeJob(data)
    }
    data.result = Status.SKIPPED
    return data
  })
}

function executeJobs(jobs) {
  const promises = []
  jobs.map(job => promises.push(() => executeJob(job)))
  return pSeries(promises)
}

module.exports = {
  executeJobs,
  executeJob,
}
