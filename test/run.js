'use strict';
const path = require('path');
const assert = require('assert');
const { loadModule, usageSnippet } = require('../src/moduleModel');

const m = loadModule(path.join(__dirname, '..', 'sample', 's3-bucket'));
assert.deepStrictEqual(m.errors, []);
assert.strictEqual(m.terraform.requiredVersion, '>= 1.5.0');
assert.deepStrictEqual(m.terraform.requiredProviders.map((p) => [p.name, p.source, p.version]),
  [['aws', 'hashicorp/aws', '~> 5.0'], ['random', undefined, '~> 3.5']]);
assert.strictEqual(m.terraform.backend.type, 's3');

assert.deepStrictEqual(m.variables.map((v) => v.name),
  ['bucket_name', 'region', 'tags', 'lifecycle_rules', 'db_password', 'unused_flag']);
const v = (n) => m.variables.find((x) => x.name === n);
assert.strictEqual(v('bucket_name').description, 'バケット名 ("prefix-" は自動付与)');
assert.strictEqual(v('bucket_name').validations.length, 1);
assert.strictEqual(v('region').default, '"ap-northeast-1"');
assert.strictEqual(v('tags').description, '追加タグ。\ncommon_tags とマージされる。');
assert.ok(v('tags').default.endsWith('}'));
assert.ok(v('lifecycle_rules').type.startsWith('list(object({'));
assert.strictEqual(v('db_password').sensitive, true);
assert.strictEqual(v('db_password').hasDefault, false);
assert.strictEqual(v('unused_flag').refs, 0);
assert.ok(v('region').refs > 0);

assert.deepStrictEqual(m.outputs.map((o) => o.name), ['bucket_id', 'bucket_arn', 'policy_json']);
assert.strictEqual(m.outputs[2].sensitive, true);

assert.deepStrictEqual(m.resources.map((r) => r.resourceType + '.' + r.name), [
  'aws_s3_bucket.this', 'aws_s3_bucket_lifecycle_configuration.this', 'aws_s3_bucket_policy.this', 'random_id.suffix']);
const lc = m.resources[1];
assert.strictEqual(lc.meta.count, 'length(var.lifecycle_rules) > 0 ? 1 : 0');
assert.strictEqual(lc.blocks[0].type, 'dynamic');
assert.strictEqual(lc.blocks[0].blocks[0].blocks[0].type, 'expiration');
assert.ok(m.resources[0].lifecycle);
assert.strictEqual(m.resources[2].meta.depends_on, '[aws_s3_bucket.this]');
assert.strictEqual(m.resources[0].line, 9);

assert.deepStrictEqual(m.dataSources.map((r) => r.resourceType), ['aws_caller_identity', 'aws_iam_policy_document']);
assert.deepStrictEqual(m.modules.map((x) => [x.name, x.source, x.version]),
  [['policy', './modules/policy', undefined], ['vpc', 'terraform-aws-modules/vpc/aws', '5.1.0']]);
assert.ok(m.modules[0].localPath);
assert.strictEqual(m.modules[1].meta.for_each, 'toset(["a", "b"])');

assert.deepStrictEqual(m.locals.map((l) => [l.name, l.refs]), [['common_tags', 2], ['full_name', 1], ['dead_local', 0]]);
assert.strictEqual(m.locals[0].value, 'merge(var.tags, { ManagedBy = "terraform" })');
assert.deepStrictEqual(m.providers.map((p) => p.alias), [undefined, 'us_east_1']);
assert.deepStrictEqual(m.others.map((o) => o.type), ['moved']);

const child = loadModule(m.modules[0].localPath);
assert.deepStrictEqual(child.variables.map((x) => x.name), ['bucket_arn', 'password']);
assert.ok(child.outputs[0].value.startsWith('jsonencode({'));

// ---- ファイル単体表示 ----
const dir = path.join(__dirname, '..', 'sample', 's3-bucket');
const fm = loadModule(dir, { file: 'main.tf' });
assert.deepStrictEqual(fm.scope, { file: 'main.tf' });
assert.deepStrictEqual(fm.errors, []);
assert.strictEqual(fm.variables.length, 0);
assert.strictEqual(fm.outputs.length, 0);
assert.strictEqual(fm.resources.length, 4);
assert.strictEqual(fm.dataSources.length, 2);
assert.strictEqual(fm.modules.length, 2);
assert.strictEqual(fm.locals.length, 3);
assert.strictEqual(fm.providers.length, 0);
assert.strictEqual(fm.terraform.requiredVersion, undefined);
assert.deepStrictEqual(fm.files.map((f) => f.file), ['main.tf']);
// 未使用判定はディレクトリ全体で行う（common_tags は versions.tf からも参照される）
assert.strictEqual(fm.locals.find((l) => l.name === 'common_tags').refs, 2);

const ref = (kind, name) => fm.references.find((r) => r.kind === kind && r.name === name);
assert.strictEqual(ref('var', 'lifecycle_rules').def.file, 'variables.tf');
assert.strictEqual(ref('var', 'db_password').def.file, 'variables.tf');
assert.strictEqual(ref('local', 'full_name').def.file, 'main.tf');
assert.strictEqual(ref('module', 'policy').def.file, 'main.tf');
assert.strictEqual(ref('data', 'aws_caller_identity.current').def.file, 'main.tf');
assert.strictEqual(ref('resource', 'aws_s3_bucket.this').count, 6);
// コメントや data.xxx の後半は拾わない
assert.ok(!fm.references.some((r) => r.kind === 'resource' && r.name.indexOf('aws_caller_identity') === 0));
assert.ok(!ref('resource', 'aws_s3_bucket.old'));

const by = (kind, name, file) => fm.referencedBy.find((r) => r.kind === kind && r.name === name && r.file === file);
assert.strictEqual(by('local', 'common_tags', 'versions.tf').line, 19);
assert.strictEqual(by('resource', 'aws_s3_bucket.this', 'outputs.tf').count, 2);
assert.strictEqual(by('module', 'policy', 'outputs.tf').count, 1);

const vf = loadModule(dir, { file: 'variables.tf' });
assert.strictEqual(vf.variables.length, 6);
assert.strictEqual(vf.resources.length, 0);
assert.deepStrictEqual(vf.references.map((r) => r.kind + ':' + r.name), ['var:bucket_name']);
assert.ok(vf.referencedBy.some((r) => r.name === 'region' && r.file === 'versions.tf'));
assert.ok(!vf.referencedBy.some((r) => r.name === 'unused_flag'));

const missing = loadModule(dir, { file: 'nope.tf' });
assert.strictEqual(missing.errors[0].file, 'nope.tf');

console.log(usageSnippet(m, './sample/s3-bucket'));
console.log('\nall assertions passed');
