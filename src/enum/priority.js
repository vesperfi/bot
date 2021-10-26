'use strict'
const Priority = {
  LOW: 0,
  HIGH: 1,
  CRITICAL: 2,
  FLASHBOT: 3,
}

function getPriority(priority) {
  if (priority === 'high') return Priority.HIGH
  if (priority === 'critical') return Priority.CRITICAL
  if (priority === 'flashbot') return Priority.FLASHBOT
  return Priority.LOW
}

module.exports = {
  Priority,
  getPriority,
}
