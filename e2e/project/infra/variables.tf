variable "service_account_id" {
  type        = string
  description = "Service account attached to the e2e functions/container (via extensions.yaml)."
}

variable "message_queue_access_key" {
  type        = string
  sensitive   = true
  description = "Static access key used by the YMQ (S3-compatible) API."
}

variable "message_queue_secret_key" {
  type        = string
  sensitive   = true
  description = "Static secret key used by the YMQ (S3-compatible) API."
}

variable "mq_access_key" {
  type        = string
  sensitive   = true
  description = "Static key passed to the worker DLQ sender (SigV4) at runtime."
}

variable "mq_secret_key" {
  type        = string
  sensitive   = true
  description = "Static secret passed to the worker DLQ sender (SigV4) at runtime."
}
