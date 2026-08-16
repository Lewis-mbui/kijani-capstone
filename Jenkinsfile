pipeline {
  agent {
    docker {
      image 'kijanikiosk-capstone-agent:22'
      args '''
        --network minikube
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
      '''
    }
  }
}