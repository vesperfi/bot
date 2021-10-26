'use strict'
const {getLogger} = require('../util/logger')
const SUCCESS_CODE = 200
const ERROR_CODE = 500

function prepareResponse(jsonObject, statusCode = SUCCESS_CODE) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(jsonObject),
  }
}

function prepareSuccessMessage(message) {
  const logger = getLogger()
  logger.info(message)
  const success = {
    message,
  }
  return prepareResponse(success)
}

function prepareErrorResponse(message, error) {
  const logger = getLogger()
  logger.error(`${message}  ${error}`)
  const errorMessage = {
    error: message,
  }
  return prepareResponse(errorMessage, ERROR_CODE)
}

module.exports = {
  prepareResponse,
  prepareSuccessMessage,
  prepareErrorResponse,
}
