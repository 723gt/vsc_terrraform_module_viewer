/* main resources
   { unbalanced brace in comment */
locals {
  common_tags = merge(var.tags, { ManagedBy = "terraform" }) // comment {
  full_name   = "prefix-${var.bucket_name}"
  dead_local  = 1
}

resource "aws_s3_bucket" "this" {
  bucket = local.full_name
  tags   = local.common_tags

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [tags["Temp"]]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  count  = length(var.lifecycle_rules) > 0 ? 1 : 0
  bucket = aws_s3_bucket.this.id

  dynamic "rule" {
    for_each = var.lifecycle_rules
    content {
      id     = rule.value.id
      status = rule.value.enabled ? "Enabled" : "Disabled"
      expiration { days = rule.value.days }
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket     = aws_s3_bucket.this.id
  policy     = module.policy.json
  depends_on = [aws_s3_bucket.this]
}

resource "random_id" "suffix" {
  byte_length = 4
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "extra" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_caller_identity.current.account_id]
    }
  }
}

module "policy" {
  source     = "./modules/policy"
  bucket_arn = aws_s3_bucket.this.arn
  password   = var.db_password
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.0"
  for_each = toset(["a", "b"])
  name    = each.key
}

moved {
  from = aws_s3_bucket.old
  to   = aws_s3_bucket.this
}
