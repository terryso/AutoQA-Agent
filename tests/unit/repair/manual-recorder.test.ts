/**
 * Unit tests for Manual Recorder functionality
 */

import { describe, it, expect, beforeEach, vi as mock } from 'vitest'
import {
  detectSensitiveField,
  valueToFillValue,
  type CapturedEvent,
} from '../../../src/repair/manual-recorder.js'

describe('manual-recorder', () => {
  describe('detectSensitiveField', () => {
    it('should detect type="password" as sensitive with PASSWORD template var', () => {
      const elementInfo = {
        tagName: 'input',
        type: 'password',
        name: 'user-password',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PASSWORD',
        reason: 'type="password"',
      })
    })

    it('should detect name containing "password" as sensitive', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'user-password',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PASSWORD',
        reason: 'name contains password/passwd/pwd',
      })
    })

    it('should detect name containing "passwd" as sensitive', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'my-passwd',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PASSWORD',
      })
    })

    it('should detect name containing "pwd" as sensitive', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'login-pwd',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PASSWORD',
      })
    })

    it('should detect name containing "secret" as sensitive with SECRET template var', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'api-secret',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'SECRET',
        reason: 'name contains secret/token/api',
      })
    })

    it('should detect name containing "token" as sensitive with SECRET template var', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'auth-token',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'SECRET',
      })
    })

    it('should detect name containing "pin" as sensitive with PIN template var', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'pin-code',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PIN',
        reason: 'name contains pin/otp/code',
      })
    })

    it('should detect name containing "otp" as sensitive with PIN template var', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'otp-input',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PIN',
      })
    })

    it('should detect type="email" as sensitive with EMAIL template var', () => {
      const elementInfo = {
        tagName: 'input',
        type: 'email',
        name: 'contact',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'EMAIL',
        reason: 'type="email"',
      })
    })

    it('should detect name containing "username" as sensitive with USERNAME template var', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'username',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'USERNAME',
        reason: 'name contains username/user',
      })
    })

    it('should detect name containing "user" as sensitive with USERNAME template var', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'user',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'USERNAME',
      })
    })

    it('should prioritize type="password" over name-based patterns', () => {
      const elementInfo = {
        tagName: 'input',
        type: 'password',
        name: 'user-username', // Contains username but type is password
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PASSWORD',
        reason: 'type="password"',
      })
    })

    it('should return non-sensitive for fields without sensitive patterns', () => {
      const elementInfo = {
        tagName: 'input',
        name: 'firstName',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: false,
        reason: 'No sensitive patterns matched',
      })
    })

    it('should return non-sensitive when element info is undefined', () => {
      const result = detectSensitiveField(undefined)

      expect(result).toMatchObject({
        isSensitive: false,
        reason: 'No element info',
      })
    })

    it('should detect id containing "password" as sensitive', () => {
      const elementInfo = {
        tagName: 'input',
        id: 'login-password',
      }

      const result = detectSensitiveField(elementInfo)

      expect(result).toMatchObject({
        isSensitive: true,
        templateVar: 'PASSWORD',
        reason: 'id contains password/passwd/pwd',
      })
    })
  })

  describe('valueToFillValue', () => {
    it('should return template_var kind for sensitive fields', () => {
      const detection = {
        isSensitive: true,
        templateVar: 'PASSWORD',
        reason: 'type="password"',
      }

      const result = valueToFillValue('mySecretPassword123', detection)

      expect(result).toEqual({
        kind: 'template_var',
        name: 'PASSWORD',
      })
    })

    it('should return template_var with EMAIL for email fields', () => {
      const detection = {
        isSensitive: true,
        templateVar: 'EMAIL',
        reason: 'type="email"',
      }

      const result = valueToFillValue('user@example.com', detection)

      expect(result).toEqual({
        kind: 'template_var',
        name: 'EMAIL',
      })
    })

    it('should return literal kind for non-sensitive fields', () => {
      const detection = {
        isSensitive: false,
        reason: 'No sensitive patterns matched',
      }

      const result = valueToFillValue('John Doe', detection)

      expect(result).toEqual({
        kind: 'literal',
        value: 'John Doe',
      })
    })

    it('should handle empty string values', () => {
      const detection = {
        isSensitive: false,
        reason: 'No sensitive patterns matched',
      }

      const result = valueToFillValue('', detection)

      expect(result).toEqual({
        kind: 'literal',
        value: '',
      })
    })

    it('should not include actual value in result when sensitive', () => {
      const detection = {
        isSensitive: true,
        templateVar: 'PASSWORD',
        reason: 'type="password"',
      }

      const result = valueToFillValue('actual-secret-password', detection)

      expect(result).toEqual({
        kind: 'template_var',
        name: 'PASSWORD',
      })
      expect(result).not.toHaveProperty('value')
    })
  })
})
