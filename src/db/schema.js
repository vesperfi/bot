'use strict'
const config = require('config')
const dynamo = require('dynamodb')
const Joi = require('joi')
const {getLogger} = require('../util/logger')
dynamo.AWS.config.update({region: config.aws.region})
const transactionTableName = `${config.env.stage}_${config.vesper.ddbTransactionTable}`

const TransactionTable = dynamo.define(transactionTableName, {
  hashKey: 'fromAddress',
  rangeKey: 'submissionDate',
  schema: {
    fromAddress: Joi.string(),
    transactionHash: Joi.string(),
    nonce: Joi.number(),
    pool: Joi.string(),
    operation: Joi.string(),
    priority: Joi.number(),
    gasPrice: Joi.string(),
    amount: Joi.string(),
    txnStatus: Joi.string(),
    submissionDate: Joi.date(),
    toAddress: Joi.string(),
    error: Joi.string(),
    payeeAddress: Joi.string(),
    assetAddress: Joi.string(),
    network: Joi.string(),
  },
  indexes: [
    {hashKey: 'pool', rangeKey: 'submissionDate', name: 'poolIndex', type: 'global'},
    {hashKey: 'txnStatus', rangeKey: 'submissionDate', name: 'statusIndex', type: 'global'},
  ],
})

function createTables() {
  dynamo.createTables(
    {
      transactionTableName: {readCapacity: 1, writeCapacity: 1},
    },
    function (err) {
      const logger = getLogger()
      if (err) {
        logger.error('Error creating tables', err)
      } else {
        logger.info('tables created.')
      }
    }
  )
}

module.exports = {
  TransactionTable,
  createTables,
}
