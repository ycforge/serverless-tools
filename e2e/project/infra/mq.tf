resource "yandex_message_queue" "e2e_worker_events" {
  name      = "e2e-worker-events"
  region_id = "ru-central1"
}

resource "yandex_message_queue" "e2e_worker_events_dlq" {
  name      = "e2e-worker-events-dlq"
  region_id = "ru-central1"
}

resource "yandex_message_queue" "e2e_worker_dlq_events" {
  name      = "e2e-worker-dlq-events"
  region_id = "ru-central1"
}

resource "yandex_message_queue" "e2e_worker_app_dlq" {
  name      = "e2e-worker-app-dlq"
  region_id = "ru-central1"
}

resource "yandex_function_trigger" "e2e_worker" {
  name = "e2e-worker-trigger"

  message_queue {
    queue_id           = yandex_message_queue.e2e_worker_events.id
    service_account_id = var.service_account_id
    batch_size         = 1
    batch_cutoff       = 1
  }

  function {
    id                 = yandex_function.e2e_worker.id
    service_account_id = var.service_account_id
  }

  dlq {
    queue_id           = yandex_message_queue.e2e_worker_events_dlq.id
    service_account_id = var.service_account_id
  }
}

resource "yandex_function_trigger" "e2e_worker_dlq" {
  name = "e2e-worker-dlq-trigger"

  message_queue {
    queue_id           = yandex_message_queue.e2e_worker_dlq_events.id
    service_account_id = var.service_account_id
    batch_size         = 1
    batch_cutoff       = 1
  }

  function {
    id                 = yandex_function.e2e_worker_dlq.id
    service_account_id = var.service_account_id
  }
}
