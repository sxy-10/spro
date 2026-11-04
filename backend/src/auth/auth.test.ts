import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPasswordConstantTime, recordLoginFailure, checkLoginLockout, clearLoginLockout, MAXIMUM_LOGIN_ATTEMPTS } from './security.js';
import { pool } from '../db/connection.js';
import { ApiError } from '../api/core.js';

test('Security Suite: Password Salting, Timing-Attack Defense & Rate-Limited Account Lockout', async () => {
  // 1. 测试慢哈希加盐
  const rawPassword = 'SecurePassword#2026';
  const passwordHash = await hashPassword(rawPassword);
  assert.ok(passwordHash.startsWith('$2'), '密码哈希必须是合法的 bcrypt 格式');
  assert.notEqual(passwordHash, rawPassword, '哈希值绝不能等同于明文');

  // 2. 测试恒定时间比对：正确密码
  const isCorrectMatched = await verifyPasswordConstantTime(rawPassword, passwordHash);
  assert.equal(isCorrectMatched, true, '正确密码必须比对成功');

  // 3. 测试恒定时间比对：错误密码
  const isWrongMatched = await verifyPasswordConstantTime('WrongPassword!999', passwordHash);
  assert.equal(isWrongMatched, false, '错误密码必须比对失败');

  // 4. 测试恒定时间比对：虚构用户（空哈希），验证抗时序攻击恒定计算
  const startTimestamp = Date.now();
  const isUnknownMatched = await verifyPasswordConstantTime('AnyPassword#123', null);
  const elapsedMilliseconds = Date.now() - startTimestamp;
  assert.equal(isUnknownMatched, false, '不存在的用户必须返回 false');
  assert.ok(elapsedMilliseconds >= 30, '即使用户不存在也必须执行一次慢哈希计算防时序探测');

  // 5. 测试输错 5 次账号锁定防线
  const testMobilePhone = '13900009999';
  await clearLoginLockout(testMobilePhone);

  // 模拟输错前 4 次
  for (let attempt = 1; attempt < MAXIMUM_LOGIN_ATTEMPTS; attempt++) {
    await recordLoginFailure(testMobilePhone);
    // 前 4 次不应被锁定抛错
    await checkLoginLockout(testMobilePhone);
  }

  // 模拟第 5 次输错
  await recordLoginFailure(testMobilePhone);

  // 此时调用 checkLoginLockout 应触发 429 异常
  await assert.rejects(
    async () => {
      await checkLoginLockout(testMobilePhone);
    },
    (err: any) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 429);
      assert.equal(err.code, 20014);
      assert.match(err.message, /密码连续输错超过 5 次，账号已被安全锁定/);
      return true;
    }
  );

  // 成功登录后清除锁定
  await clearLoginLockout(testMobilePhone);
  await checkLoginLockout(testMobilePhone); // 不应再抛出异常
});
