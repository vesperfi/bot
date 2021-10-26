'use strict'
const config = require('config')
const {PapertrailTransport} = require('winston-papertrail-transport')
const {Env} = require('../enum/env')
const winston = require('winston')

class Logger {
  constructor() {
    if (!Logger.instance) {
      const transports = [new winston.transports.Console(config.logger.Console)]
      if (process.env.STAGE === Env.STAGE) {
        const ptConfig = {
          host: process.env.LOGGER_PAPERTRAIL_HOST,
          port: process.env.LOGGER_PAPERTRAIL_PORT,
          level: config.logger.Papertrail.level,
          program: config.logger.Papertrail.program,
        }
        transports.push(new PapertrailTransport(ptConfig))
      }
      this.logger = winston.createLogger({
        format: winston.format.combine(winston.format.splat(), winston.format.colorize(), winston.format.simple()),
        transports,
      })
      Logger.instance = this
    }
  }
}

function getLogger() {
  if (!Logger.instance) {
    const logger = new Logger()
    return logger.logger
  }
  return Logger.instance.logger
}

function logTransaction(txnParams, error) {
  const logger = getLogger()
  const {ignoreTransactionError} = require('./transactionUtil')
  if (txnParams.error || error) {
    const _error = txnParams.error || error.message || error
    const msg = `Error in sendTransaction transaction, operation: ${txnParams.operation}, pool: ${
      txnParams.pool || txnParams.name
    }, toAddress: ${txnParams.toAddress}, nonce: ${txnParams.nonce}, error: ${_error}`
    if (ignoreTransactionError(_error)) {
      logger.warn(msg)
    } else {
      logger.error(msg)
    }
  } else {
    let additionalData = ''
    if (txnParams.payeeAddress) {
      additionalData = `, payeeAddress: ${txnParams.payeeAddress}`
    }
    if (txnParams.assetAddress) {
      additionalData = `, assetAddress: ${txnParams.assetAddress}`
    }
    logger.info(
      'Successful submission. Operation: %s performed for pool: %s, network: %s ' +
        'transactionHash: %s, nonce: %s, gasPrice: %s %s',
      txnParams.operation,
      txnParams.pool || txnParams.name,
      txnParams.network,
      txnParams.transactionHash,
      txnParams.nonce,
      txnParams.gasPrice,
      additionalData
    )
  }
}

module.exports = {
  getLogger,
  logTransaction,
}
