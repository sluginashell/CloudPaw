# PawCloud 🐾

A cloud-native pet adoption platform connecting animal shelters and rescues with prospective adopters.

> **Status:** Front-end complete · Cloud backend in development (AWS)

## Overview

PawCloud is a two-person capstone project for the BS Cloud Computing program at Franklin University. The front end is a static HTML/CSS/JavaScript application designed to be deployed to Amazon S3 and distributed via CloudFront. The backend (in progress) will use API Gateway, AWS Lambda, and DynamoDB, with authentication handled by Amazon Cognito.

## Tech Stack

| Layer          | Technology                                          |
|----------------|-----------------------------------------------------|
| Front end      | HTML5, CSS3 (custom properties, Grid, Flexbox), vanilla JavaScript |
| Hosting        | Amazon S3 + CloudFront *(planned)*                  |
| API            | Amazon API Gateway + AWS Lambda *(planned)*         |
| Database       | Amazon DynamoDB or RDS *(under evaluation)*         |
| Auth           | Amazon Cognito *(planned)*                          |
| IaC            | AWS CloudFormation or Terraform *(planned)*         |
| Monitoring     | Amazon CloudWatch *(planned)*                       |

## Features

- Responsive, mobile-first layout
- Accessible markup (skip links, ARIA, keyboard-friendly)
- Live pet listings fetched from a configurable API
- Search by name, breed, or species
- Skeleton loading states
- Foundation ready for Cognito authentication and inquiry workflow

## Local Development

```bash
# Serve locally (Python 3)
python3 -m http.server 8000
# Then open http://localhost:8000