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

console.log(usageSnippet(m, './sample/s3-bucket'));
console.log('\nall assertions passed');
