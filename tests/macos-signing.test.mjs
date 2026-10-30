import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withSigningEnvironment, signingError } from '../tools/package-macos.mjs';
import { isStaplerNetworkFailure, retryDelays, runStapler } from '../tools/macos-stapler.mjs';
import { notarizeApp } from '../tools/notarize-macos.mjs';
const signed = { CSC_LINK:'fake-p12',CSC_KEY_PASSWORD:'fake-password',APPLE_API_KEY_P8:'fake-private-key',APPLE_API_KEY_ID:'fake-id',APPLE_API_ISSUER:'fake-issuer',APPLE_TEAM_ID:'fake-team' };
for (const adHoc of [false,true]) test(`无证书或显式临时签名清理凭据 ${adHoc}`, async () => {
  const source={...signed, CSC_LINK:adHoc?'fake-p12':'',APPLE_ID:'fake-id',APPLE_APP_SPECIFIC_PASSWORD:'fake-password'};
  await withSigningEnvironment(source,adHoc,async(env,enabled)=>{
    assert.equal(enabled,false);assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY,'false');
    for(const key of Object.keys(signed))assert.equal(env[key],undefined);
    assert.equal(env.APPLE_ID,undefined);assert.equal(env.APPLE_APP_SPECIFIC_PASSWORD,undefined);
  });
  assert.equal(source.APPLE_API_KEY_P8,'fake-private-key');
});
for(const key of Object.keys(signed).filter(k=>k!=='CSC_LINK'))test(`签名缺少 ${key} 立即失败`,async()=>{
  await assert.rejects(withSigningEnvironment({...signed,[key]:''},false,()=>assert.fail('不应打包')),new RegExp(key));
});
for(const failure of [false,true])test(`私钥临时文件及清理，失败=${failure}`,async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dispatchdock-signing-test-'));let key;
  try{
    const action=withSigningEnvironment({...signed,RUNNER_TEMP:temp,CSC_IDENTITY_AUTO_DISCOVERY:'false'},false,async(env,enabled)=>{
      key=env.APPLE_API_KEY;assert.equal(enabled,true);assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY,'true');assert.equal(env.APPLE_API_KEY_P8,undefined);
      assert.equal(await fs.readFile(key,'utf8'),'fake-private-key');assert.equal(path.dirname(path.dirname(key)),temp);
      if(process.platform!=='win32')assert.equal((await fs.stat(key)).mode&0o777,0o600);
      if(failure)throw Error('fake-build-failure');
    });
    if(failure)await assert.rejects(action,/fake-build-failure/);else await action;
    await assert.rejects(fs.stat(key),{code:'ENOENT'});assert.deepEqual(await fs.readdir(temp),[]);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
for(const output of ['Error 68','Code=-1005','NSURLErrorDomain',"CloudKit's response is inconsistent"])test(`可重试：${output}`,()=>assert.equal(isStaplerNetworkFailure(output),true));
for(const output of ['invalid signature','ticket not found','CloudKit: record not found','status: Rejected','unknown error'])test(`不可重试：${output}`,()=>assert.equal(isStaplerNetworkFailure(output),false));
for(const action of ['staple','validate'])test(`${action} 最多五次退避`,async()=>{
  let calls=0;const waits=[];
  await assert.rejects(runStapler(action,'fixture.app',{run:()=>{calls++;throw Error('Error 68');},wait:ms=>waits.push(ms),log:()=>{}}),/Error 68/);
  assert.equal(calls,5);assert.deepEqual(waits,[...retryDelays]);
});
test('永久错误立即停止',async()=>{
  let calls=0;await assert.rejects(runStapler('validate','fixture.app',{run:()=>{calls++;throw Error('invalid signature');},wait:()=>assert.fail()}),/invalid signature/);assert.equal(calls,1);
});
test('公证只提交一次，票据网络错误单独重试',async()=>{
  const calls=[],actions=[];
  await notarizeApp('fixture.app',{}, {run:(cmd,args)=>{calls.push([cmd,args]);return '{"status":"Accepted"}';},staple:(action,app)=>runStapler(action,app,{run:(_cmd,args)=>{actions.push(args[1]);if(actions.length===1)throw Error('NSURLErrorDomain -1005');},wait:()=>{},log:()=>{}})});
  assert.equal(calls.filter(([,args])=>args[0]==='notarytool').length,1);assert.deepEqual(actions,['staple','staple','validate']);
});
test('公证拒绝后不装订票据',async()=>{
  await assert.rejects(notarizeApp('fixture.app',{}, {run:()=>'{"status":"Invalid"}',staple:()=>assert.fail()}),/Notarization rejected/);
});

test('签名错误不回显证书或临时钥匙串密码',()=>{
  const message=signingError(Error('security -P fake-password -k temporary-password fake-p12 fake-private-key'),signed);
  assert.doesNotMatch(message,/fake-password|temporary-password|fake-p12|fake-private-key/);
  assert.match(message,/security/);
});
