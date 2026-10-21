variable "bucket_name" {
  description = "バケット名 (\"prefix-\" は自動付与)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]{3,63}$", var.bucket_name))
    error_message = "バケット名は小文字英数字とハイフンのみ。"
  }
}

variable "region" {
  type    = string
  default = "ap-northeast-1" # Tokyo
}

variable "tags" {
  description = <<-EOT
    追加タグ。
    common_tags とマージされる。
  EOT
  type = map(string)
  default = {
    Owner = "platform"
    Note  = "contains } brace and ${"{"} interpolation"
  }
}

variable "lifecycle_rules" {
  type = list(object({
    id      = string
    days    = number
    enabled = optional(bool, true)
  }))
  default = []
}

variable "db_password" {
  type      = string
  sensitive = true
  nullable  = false
}

variable "unused_flag" {
  type    = bool
  default = false
}
