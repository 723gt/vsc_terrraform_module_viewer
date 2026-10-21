output "bucket_id" {
  description = "作成したバケットの ID"
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "policy_json" {
  value     = module.policy.json
  sensitive = true
}
