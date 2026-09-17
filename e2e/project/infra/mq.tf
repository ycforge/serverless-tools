locals {
  # yandex_message_queue.id is the SQS-style queue URL
  # (https://.../<cloud-id>/<queue-id>/<queue-name>), but the connector's DLQ
  # HTTP API needs the raw queue id (<queue-id>).
  e2e_worker_app_dlq_queue_id = regex("/([^/]+)/[^/]+$", yandex_message_queue.e2e_worker_app_dlq.id)[0]
}

resource "yandex_message_queue" "e2e_worker_events" {
  access_key = var.message_queue_access_key
  secret_key = var.message_queue_secret_key
  name       = "e2e-worker-events"
  region_id  = "ru-central1"
}

resource "yandex_message_queue" "e2e_worker_dlq_events" {
  access_key = var.message_queue_access_key
  secret_key = var.message_queue_secret_key
  name       = "e2e-worker-dlq-events"
  region_id  = "ru-central1"
}

resource "yandex_message_queue" "e2e_worker_app_dlq" {
  access_key = var.message_queue_access_key
  secret_key = var.message_queue_secret_key
  name       = "e2e-worker-app-dlq"
  region_id  = "ru-central1"
}

resource "yandex_function_trigger" "e2e_worker" {
  name = "e2e-worker-trigger"

  message_queue {
    queue_id           = yandex_message_queue.e2e_worker_events.arn
    service_account_id = var.service_account_id
    batch_size         = 1
    batch_cutoff       = 1
  }

  function {
    id                 = yandex_function.e2e_worker.id
    service_account_id = var.service_account_id
  }
}

resource "yandex_function_trigger" "e2e_worker_dlq" {
  name = "e2e-worker-dlq-trigger"

  message_queue {
    queue_id           = yandex_message_queue.e2e_worker_dlq_events.arn
    service_account_id = var.service_account_id
    batch_size         = 1
    batch_cutoff       = 1
  }

  function {
    id                 = yandex_function.e2e_worker_dlq.id
    service_account_id = var.service_account_id
  }
}
