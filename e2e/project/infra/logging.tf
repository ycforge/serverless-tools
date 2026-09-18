resource "yandex_logging_group" "e2e" {
  name             = "e2e-logs"
  retention_period = "1h"
}
