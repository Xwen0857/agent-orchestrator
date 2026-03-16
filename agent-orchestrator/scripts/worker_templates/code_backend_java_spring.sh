#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR/src/main/java/com/example/demo"
mkdir -p "$DELIVERY_DIR/src/test/java/com/example/demo"

TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="gradle_smoke"

cat > "$DELIVERY_DIR/build.gradle" <<'GRADLE'
plugins {
  id 'java'
}

group = 'com.example'
version = '0.0.1'

repositories {
  mavenCentral()
}
GRADLE

cat > "$DELIVERY_DIR/src/main/java/com/example/demo/Application.java" <<'JAVA'
package com.example.demo;

public class Application {
  public static void main(String[] args) {
    System.out.println("Spring-style application placeholder");
  }
}
JAVA

cat > "$DELIVERY_DIR/src/main/java/com/example/demo/HealthController.java" <<'JAVA'
package com.example.demo;

public class HealthController {
  public String health() {
    return "ok";
  }
}
JAVA

cat > "$DELIVERY_DIR/src/test/java/com/example/demo/HealthControllerTest.java" <<'JAVA'
package com.example.demo;

public class HealthControllerTest {
  public static void main(String[] args) {
    if (!"ok".equals(new HealthController().health())) {
      throw new IllegalStateException("health endpoint contract mismatch");
    }
    System.out.println("java smoke passed");
  }
}
JAVA

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# Java Spring Backend Runbook

## Delivery
- Main class: \`src/main/java/com/example/demo/Application.java\`
- Health endpoint contract: \`src/main/java/com/example/demo/HealthController.java\`
- Smoke test: compile and run \`HealthControllerTest\`

## Template Defaults
- test_mode: ${TEST_MODE}
MD

jq -cn \
  --arg summary "generated java spring backend delivery skeleton" \
  --arg test_command "cd delivery && javac src/main/java/com/example/demo/*.java src/test/java/com/example/demo/HealthControllerTest.java && java -cp src/main/java:src/test/java com.example.demo.HealthControllerTest" \
  --argjson changed_files '[
    "delivery/build.gradle",
    "delivery/src/main/java/com/example/demo/Application.java",
    "delivery/src/main/java/com/example/demo/HealthController.java",
    "delivery/src/test/java/com/example/demo/HealthControllerTest.java",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/build.gradle",
    "delivery/src/main/java/com/example/demo/Application.java",
    "delivery/src/main/java/com/example/demo/HealthController.java",
    "delivery/src/test/java/com/example/demo/HealthControllerTest.java",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-service_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
