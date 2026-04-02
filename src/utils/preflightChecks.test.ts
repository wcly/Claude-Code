import { expect, test } from 'bun:test'

import { checkEndpoints } from './preflightChecks.js'

test('startup preflight connectivity check is bypassed', async () => {
  await expect(checkEndpoints()).resolves.toEqual({ success: true })
})
