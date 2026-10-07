variable "subscription_id" {
  description = "Azure subscription ID where resources will be created"
  type        = string
}

variable "project_name" {
  description = "Name of the project/client, used for naming resources (3-24 chars, lowercase letters and numbers only)"
  type        = string
}

variable "location" {
  description = "Azure location where resources will be created"
  type        = string
}
