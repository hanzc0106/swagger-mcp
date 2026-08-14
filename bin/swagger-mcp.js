#!/usr/bin/env node
import { startServer } from '../src/server.js'

startServer().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exit(1)
})
