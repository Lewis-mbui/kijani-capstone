pipeline {
  agent {
    docker {
      image 'kijanikiosk-capstone-agent:22'
      args '''
        --network minikube
        --group-add 973
        -v /var/run/docker.sock:/var/run/docker.sock
      '''
      reuseNode true
    }
  }

  options {
    skipDefaultCheckout(true)
    timeout(time: 20, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  environment {
    APP_NAME          = 'kk-payments'
    IMAGE_REPO        = 'lewis0648/kk-payments'
    DOCKERFILE        = 'Dockerfile.production'
    PAYMENTS_REPO_URL = 'https://github.com/Lewis-mbui/kijanikiosk-payments.git'

    STAGING_NAMESPACE = 'kijani-staging'
    PRODUCTION_NAMESPACE = 'kijani-project'
    DEPLOYMENT_NAME   = 'kk-payments'
    CONTAINER_NAME    = 'kk-payments'
  }

  stages {

    stage('Checkout') {
      steps {
        echo 'Checking out capstone orchestration repository...'

        checkout scm

        echo 'Checking out kk-payments application repository...'

        dir('kk-payments') {
          git branch: 'main',
              url: "${PAYMENTS_REPO_URL}"
        }
      }
    }

    stage('Prepare Release') {
      steps {
        dir('kk-payments') {
          script {
            env.PKG_VERSION = sh(
              script: '''
                node -p "require('./package.json').version"
              ''',
              returnStdout: true
            ).trim()

            env.GIT_SHORT = sh(
              script: 'git rev-parse --short HEAD',
              returnStdout: true
            ).trim()

            env.IMAGE_TAG =
              "${env.PKG_VERSION}-${env.GIT_SHORT}"

            env.FULL_IMAGE =
              "${env.IMAGE_REPO}:${env.IMAGE_TAG}"
          }
        }

        echo "Application version: ${PKG_VERSION}"
        echo "Git SHA: ${GIT_SHORT}"
        echo "Release image: ${FULL_IMAGE}"
      }
    }

    stage('Docker Test') {
      steps {
        dir('kk-payments') {
          sh '''
            set -e

            echo "Running containerized lint, test, and build..."

            docker build \
              --target test \
              -f "${DOCKERFILE}" \
              -t "${APP_NAME}:test-${BUILD_NUMBER}" \
              .
          '''
        }
      }
    }

    stage('Build Image') {
      steps {
        dir('kk-payments') {
          sh '''
            set -e

            echo "Building immutable production image:"
            echo "${FULL_IMAGE}"

            docker build \
              --target production \
              -f "${DOCKERFILE}" \
              -t "${FULL_IMAGE}" \
              .
          '''
        }
      }
    }

    stage('Verify Image') {
      steps {
        sh '''
          set -e

          echo "Built image:"
          docker image inspect "${FULL_IMAGE}" \
            --format='{{.RepoTags}}'

          echo "Image ID:"
          docker image inspect "${FULL_IMAGE}" \
            --format='{{.Id}}'
        '''
      }
    }

    stage('Push Image') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'dockerhub-credentials',
            usernameVariable: 'DOCKERHUB_USERNAME',
            passwordVariable: 'DOCKERHUB_TOKEN'
          )
        ]) {
          sh '''
            set -e

            echo "Authenticating to Docker Hub..."

            echo "${DOCKERHUB_TOKEN}" |
              docker login \
                --username "${DOCKERHUB_USERNAME}" \
                --password-stdin

             echo "Checking immutable release tag ${FULL_IMAGE}..."

            if docker manifest inspect "${FULL_IMAGE}" >/dev/null 2>&1; then
              echo "Image already exists in Docker Hub."
              echo "Reusing immutable release ${FULL_IMAGE}; push skipped."
            else
              echo "Publishing new immutable release ${FULL_IMAGE}..."
              docker push "${FULL_IMAGE}"
            fi

            docker logout
          '''
        }
      }
    }

    stage('Deploy Staging') {
      steps {
        withCredentials([
          file(
            credentialsId: 'minikube-kubeconfig',
            variable: 'KUBECONFIG'
          )
        ]) {
          sh '''
            set -e

            echo "Rendering shared Deployment manifest..."
            mkdir -p .jenkins-rendered

            sed \
              -e "s|lewis0648/kk-payments:PIPELINE_REQUIRED|${FULL_IMAGE}|g" \
              -e "s|PIPELINE_VERSION_REQUIRED|${IMAGE_TAG}|g" \
              k8s/kk-payments-deployment.yaml \
              > .jenkins-rendered/kk-payments-deployment.yaml

            echo "Applying staging runtime..."
            kubectl apply \
              -f .jenkins-rendered/kk-payments-deployment.yaml \
              -f k8s/kk-payments-service.yaml \
              -n "${STAGING_NAMESPACE}"
          '''
        }
      }
    }

    stage('Verify Staging Rollout') {
      steps {
        withCredentials([
          file(
            credentialsId: 'minikube-kubeconfig',
            variable: 'KUBECONFIG'
          )
        ]) {
          sh '''
            set -e

            echo "Waiting for staging rollout..."

            kubectl rollout status \
              deployment/${DEPLOYMENT_NAME} \
              -n "${STAGING_NAMESPACE}" \
              --timeout=120s

            DEPLOYED_IMAGE=$(
              kubectl get deployment "${DEPLOYMENT_NAME}" \
                -n "${STAGING_NAMESPACE}" \
                -o jsonpath='{.spec.template.spec.containers[0].image}'
            )

            echo "Expected image: ${FULL_IMAGE}"
            echo "Deployed image: ${DEPLOYED_IMAGE}"

            if [ "${DEPLOYED_IMAGE}" != "${FULL_IMAGE}" ]; then
              echo "ERROR: staging image does not match the release image"
              exit 1
            fi

            echo "Staging pods:"
            kubectl get pods \
              -n "${STAGING_NAMESPACE}" \
              -l app=kk-payments
          '''
        }
      }
    }

    stage('Smoke Test Staging') {
      steps {
        withCredentials([
          file(
            credentialsId: 'minikube-kubeconfig',
            variable: 'KUBECONFIG'
          )
        ]) {
          sh '''
            set -e

            echo "Running staging smoke test..."

            ATTEMPT=1
            MAX_ATTEMPTS=5

            while [ "${ATTEMPT}" -le "${MAX_ATTEMPTS}" ]; do
              echo "Smoke test attempt ${ATTEMPT}/${MAX_ATTEMPTS}"

              RESPONSE=$(
                kubectl exec \
                  -n "${STAGING_NAMESPACE}" \
                  deployment/${DEPLOYMENT_NAME} \
                  -- wget -qO- \
                  "http://${DEPLOYMENT_NAME}:3001/health"
              ) || true

              echo "Response: ${RESPONSE}"

              if echo "${RESPONSE}" |
                  grep -q '"status":"ok"' &&
                echo "${RESPONSE}" |
                  grep -q "\\"version\\":\\"${IMAGE_TAG}\\""; then

                echo "Staging smoke test PASSED."
                exit 0
              fi

              ATTEMPT=$((ATTEMPT + 1))
              sleep 3
            done

            echo "ERROR: staging smoke test failed."
            echo "Expected healthy response from release ${IMAGE_TAG}."
            exit 1
          '''
        }
      }
    }

    stage('Approve Production') {
      options {
        timeout(time: 10, unit: 'MINUTES')
      }

      steps {
        script {
          input(
            message: """
Staging validation PASSED.

Release: ${FULL_IMAGE}
Staging: ${STAGING_NAMESPACE}

Promote this exact image to production?
""",
            ok: 'Deploy to Production'
          )
        }
      }
    }

    stage('Deploy Production') {
      steps {
        withCredentials([
          file(
            credentialsId: 'minikube-kubeconfig',
            variable: 'KUBECONFIG'
          )
        ]) {
          sh '''
            set -e

            echo "Promoting the validated staging release to production:"
            echo "${FULL_IMAGE}"

            kubectl apply \
              -f .jenkins-rendered/kk-payments-deployment.yaml \
              -f k8s/kk-payments-service.yaml \
              -n "${PRODUCTION_NAMESPACE}"
          '''
        }
      }
    }

    stage('Verify Production') {
      steps {
        withCredentials([
          file(
            credentialsId: 'minikube-kubeconfig',
            variable: 'KUBECONFIG'
          )
        ]) {
          sh '''
            set -e

            echo "Waiting for production rollout..."

            kubectl rollout status \
              deployment/${DEPLOYMENT_NAME} \
              -n "${PRODUCTION_NAMESPACE}" \
              --timeout=120s

            DEPLOYED_IMAGE=$(
              kubectl get deployment "${DEPLOYMENT_NAME}" \
                -n "${PRODUCTION_NAMESPACE}" \
                -o jsonpath='{.spec.template.spec.containers[0].image}'
            )

            echo "Approved image: ${FULL_IMAGE}"
            echo "Production image: ${DEPLOYED_IMAGE}"

            if [ "${DEPLOYED_IMAGE}" != "${FULL_IMAGE}" ]; then
              echo "ERROR: production is not running the approved image"
              exit 1
            fi

            kubectl get pods \
              -n "${PRODUCTION_NAMESPACE}" \
              -l app=kk-payments
          '''
        }
      }
    }

    stage('Smoke Test Production') {
      steps {
        withCredentials([
          file(
            credentialsId: 'minikube-kubeconfig',
            variable: 'KUBECONFIG'
          )
        ]) {
          sh '''
            set -e

            echo "Running production smoke test..."

            ATTEMPT=1
            MAX_ATTEMPTS=5

            while [ "${ATTEMPT}" -le "${MAX_ATTEMPTS}" ]; do
              echo "Smoke test attempt ${ATTEMPT}/${MAX_ATTEMPTS}"

              RESPONSE=$(
                kubectl exec \
                  -n "${PRODUCTION_NAMESPACE}" \
                  deployment/${DEPLOYMENT_NAME} \
                  -- wget -qO- \
                  "http://${DEPLOYMENT_NAME}:3001/health"
              ) || true

              echo "Response: ${RESPONSE}"

              if echo "${RESPONSE}" |
                  grep -q '"status":"ok"' &&
                echo "${RESPONSE}" |
                  grep -q "\\"version\\":\\"${IMAGE_TAG}\\""; then

                echo "Production smoke test PASSED."
                exit 0
              fi

              ATTEMPT=$((ATTEMPT + 1))
              sleep 3
            done

            echo "ERROR: production smoke test failed."
            echo "Expected release ${IMAGE_TAG}."
            exit 1
          '''
        }
      }
    }
  }

  post {
    success {
      echo "SUCCESS: Built and tested ${FULL_IMAGE}"
    }

    failure {
      echo "FAILURE: ${JOB_NAME} #${BUILD_NUMBER}"
    }

    always {
      sh '''
        docker image rm \
          "${APP_NAME}:test-${BUILD_NUMBER}" \
          2>/dev/null || true

        rm -rf .jenkins-rendered
      '''
    }
  }
}