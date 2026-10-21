variable "bucket_arn" { type = string }
variable "password" {
  type      = string
  sensitive = true
}
output "json" {
  value = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Deny", Resource = "${var.bucket_arn}/*", Action = "s3:*" }]
  })
}
