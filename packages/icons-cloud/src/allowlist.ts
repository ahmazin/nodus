/**
 * Curated allowlist of cloud-provider icons: canonical 'provider:service' name -> vendored source
 * SVG file. `scripts/build-icon-packs.ts` reads this list, looks each `file` up under
 * `packages/icons-cloud/svg/<provider>/`, and converts it into a VectorIcon.
 *
 * Curation policy: the most-diagrammed services per provider (compute, containers, storage,
 * database, networking, integration, security, analytics, ai, management), using each provider's
 * primary/current icon (Classic/deprecated variants are excluded). AWS uses the 48px architecture
 * tiles (self-contained colored square + white glyph); Azure and GCP use the transparent-background
 * service glyphs. `needsChip` is set on low-contrast art that would wash out on a dark tile.
 */
export interface AllowEntry {
  name: string; // canonical 'provider:service'
  provider: 'aws' | 'azure' | 'gcp';
  service: string; // 'lambda'
  file: string; // source file under svg/<provider>/
  category: string; // 'compute' | 'storage' | ...
  needsChip?: boolean; // light chip behind low-contrast art
}

export const ALLOWLIST: AllowEntry[] = [
  // ------------------------------------------------------------------ AWS
  // compute
  { name: 'aws:ec2', provider: 'aws', service: 'ec2', file: 'Arch_Amazon-EC2_48.svg', category: 'compute' },
  { name: 'aws:lambda', provider: 'aws', service: 'lambda', file: 'Arch_AWS-Lambda_48.svg', category: 'compute' },
  { name: 'aws:elastic-beanstalk', provider: 'aws', service: 'elastic-beanstalk', file: 'Arch_AWS-Elastic-Beanstalk_48.svg', category: 'compute' },
  { name: 'aws:batch', provider: 'aws', service: 'batch', file: 'Arch_AWS-Batch_48.svg', category: 'compute' },
  // containers
  { name: 'aws:ecs', provider: 'aws', service: 'ecs', file: 'Arch_Amazon-Elastic-Container-Service_48.svg', category: 'containers' },
  { name: 'aws:eks', provider: 'aws', service: 'eks', file: 'Arch_Amazon-Elastic-Kubernetes-Service_48.svg', category: 'containers' },
  { name: 'aws:fargate', provider: 'aws', service: 'fargate', file: 'Arch_AWS-Fargate_48.svg', category: 'containers' },
  { name: 'aws:ecr', provider: 'aws', service: 'ecr', file: 'Arch_Amazon-Elastic-Container-Registry_48.svg', category: 'containers' },
  // storage
  { name: 'aws:s3', provider: 'aws', service: 's3', file: 'Arch_Amazon-Simple-Storage-Service_48.svg', category: 'storage' },
  { name: 'aws:ebs', provider: 'aws', service: 'ebs', file: 'Arch_Amazon-Elastic-Block-Store_48.svg', category: 'storage' },
  { name: 'aws:efs', provider: 'aws', service: 'efs', file: 'Arch_Amazon-EFS_48.svg', category: 'storage' },
  // database
  { name: 'aws:rds', provider: 'aws', service: 'rds', file: 'Arch_Amazon-RDS_48.svg', category: 'database' },
  { name: 'aws:dynamodb', provider: 'aws', service: 'dynamodb', file: 'Arch_Amazon-DynamoDB_48.svg', category: 'database' },
  { name: 'aws:aurora', provider: 'aws', service: 'aurora', file: 'Arch_Amazon-Aurora_48.svg', category: 'database' },
  { name: 'aws:elasticache', provider: 'aws', service: 'elasticache', file: 'Arch_Amazon-ElastiCache_48.svg', category: 'database' },
  { name: 'aws:redshift', provider: 'aws', service: 'redshift', file: 'Arch_Amazon-Redshift_48.svg', category: 'analytics' },
  // networking
  { name: 'aws:vpc', provider: 'aws', service: 'vpc', file: 'Arch_Amazon-Virtual-Private-Cloud_48.svg', category: 'networking' },
  { name: 'aws:cloudfront', provider: 'aws', service: 'cloudfront', file: 'Arch_Amazon-CloudFront_48.svg', category: 'networking' },
  { name: 'aws:route53', provider: 'aws', service: 'route53', file: 'Arch_Amazon-Route-53_48.svg', category: 'networking' },
  { name: 'aws:api-gateway', provider: 'aws', service: 'api-gateway', file: 'Arch_Amazon-API-Gateway_48.svg', category: 'networking' },
  { name: 'aws:elb', provider: 'aws', service: 'elb', file: 'Arch_Elastic-Load-Balancing_48.svg', category: 'networking' },
  // integration
  { name: 'aws:sqs', provider: 'aws', service: 'sqs', file: 'Arch_Amazon-Simple-Queue-Service_48.svg', category: 'integration' },
  { name: 'aws:sns', provider: 'aws', service: 'sns', file: 'Arch_Amazon-Simple-Notification-Service_48.svg', category: 'integration' },
  { name: 'aws:eventbridge', provider: 'aws', service: 'eventbridge', file: 'Arch_Amazon-EventBridge_48.svg', category: 'integration' },
  { name: 'aws:step-functions', provider: 'aws', service: 'step-functions', file: 'Arch_AWS-Step-Functions_48.svg', category: 'integration' },
  // security
  { name: 'aws:iam', provider: 'aws', service: 'iam', file: 'Arch_AWS-Identity-and-Access-Management_48.svg', category: 'security' },
  { name: 'aws:cognito', provider: 'aws', service: 'cognito', file: 'Arch_Amazon-Cognito_48.svg', category: 'security' },
  { name: 'aws:waf', provider: 'aws', service: 'waf', file: 'Arch_AWS-WAF_48.svg', category: 'security' },
  { name: 'aws:secrets-manager', provider: 'aws', service: 'secrets-manager', file: 'Arch_AWS-Secrets-Manager_48.svg', category: 'security' },
  { name: 'aws:kms', provider: 'aws', service: 'kms', file: 'Arch_AWS-Key-Management-Service_48.svg', category: 'security' },
  // management / analytics / ai / devtools
  { name: 'aws:cloudwatch', provider: 'aws', service: 'cloudwatch', file: 'Arch_Amazon-CloudWatch_48.svg', category: 'management' },
  { name: 'aws:cloudformation', provider: 'aws', service: 'cloudformation', file: 'Arch_AWS-CloudFormation_48.svg', category: 'management' },
  { name: 'aws:kinesis', provider: 'aws', service: 'kinesis', file: 'Arch_Amazon-Kinesis_48.svg', category: 'analytics' },
  { name: 'aws:sagemaker', provider: 'aws', service: 'sagemaker', file: 'Arch_Amazon-SageMaker_48.svg', category: 'ai' },
  { name: 'aws:bedrock', provider: 'aws', service: 'bedrock', file: 'Arch_Amazon-Bedrock_48.svg', category: 'ai' },
  { name: 'aws:codepipeline', provider: 'aws', service: 'codepipeline', file: 'Arch_AWS-CodePipeline_48.svg', category: 'devtools' },

  // ------------------------------------------------------------------ Azure
  // compute
  { name: 'azure:vm', provider: 'azure', service: 'vm', file: '10021-icon-service-Virtual-Machine.svg', category: 'compute' },
  { name: 'azure:functions', provider: 'azure', service: 'functions', file: '10029-icon-service-Function-Apps.svg', category: 'compute' },
  { name: 'azure:app-service', provider: 'azure', service: 'app-service', file: '10035-icon-service-App-Services.svg', category: 'compute' },
  { name: 'azure:vm-scale-sets', provider: 'azure', service: 'vm-scale-sets', file: '10034-icon-service-VM-Scale-Sets.svg', category: 'compute' },
  { name: 'azure:batch', provider: 'azure', service: 'batch', file: '10031-icon-service-Batch-Accounts.svg', category: 'compute' },
  // containers
  { name: 'azure:aks', provider: 'azure', service: 'aks', file: '10023-icon-service-Kubernetes-Services.svg', category: 'containers' },
  { name: 'azure:container-instances', provider: 'azure', service: 'container-instances', file: '10104-icon-service-Container-Instances.svg', category: 'containers' },
  { name: 'azure:container-registry', provider: 'azure', service: 'container-registry', file: '10105-icon-service-Container-Registries.svg', category: 'containers' },
  // storage
  { name: 'azure:storage-account', provider: 'azure', service: 'storage-account', file: '10086-icon-service-Storage-Accounts.svg', category: 'storage' },
  { name: 'azure:netapp-files', provider: 'azure', service: 'netapp-files', file: '10096-icon-service-Azure-NetApp-Files.svg', category: 'storage' },
  // database
  { name: 'azure:sql-database', provider: 'azure', service: 'sql-database', file: '10130-icon-service-SQL-Database.svg', category: 'database' },
  { name: 'azure:cosmos-db', provider: 'azure', service: 'cosmos-db', file: '10121-icon-service-Azure-Cosmos-DB.svg', category: 'database' },
  { name: 'azure:database-mysql', provider: 'azure', service: 'database-mysql', file: '10122-icon-service-Azure-Database-MySQL-Server.svg', category: 'database' },
  { name: 'azure:database-postgresql', provider: 'azure', service: 'database-postgresql', file: '10131-icon-service-Azure-Database-PostgreSQL-Server.svg', category: 'database' },
  { name: 'azure:sql-managed-instance', provider: 'azure', service: 'sql-managed-instance', file: '10136-icon-service-SQL-Managed-Instance.svg', category: 'database' },
  // networking
  { name: 'azure:virtual-network', provider: 'azure', service: 'virtual-network', file: '10061-icon-service-Virtual-Networks.svg', category: 'networking' },
  { name: 'azure:load-balancer', provider: 'azure', service: 'load-balancer', file: '10062-icon-service-Load-Balancers.svg', category: 'networking' },
  { name: 'azure:application-gateway', provider: 'azure', service: 'application-gateway', file: '10076-icon-service-Application-Gateways.svg', category: 'networking' },
  { name: 'azure:dns-zones', provider: 'azure', service: 'dns-zones', file: '10064-icon-service-DNS-Zones.svg', category: 'networking' },
  { name: 'azure:firewall', provider: 'azure', service: 'firewall', file: '10084-icon-service-Firewalls.svg', category: 'networking' },
  { name: 'azure:front-door', provider: 'azure', service: 'front-door', file: '10073-icon-service-Front-Door-and-CDN-Profiles.svg', category: 'networking' },
  // integration
  { name: 'azure:service-bus', provider: 'azure', service: 'service-bus', file: '10836-icon-service-Azure-Service-Bus.svg', category: 'integration' },
  { name: 'azure:api-management', provider: 'azure', service: 'api-management', file: '10042-icon-service-API-Management-Services.svg', category: 'integration' },
  { name: 'azure:logic-apps', provider: 'azure', service: 'logic-apps', file: '02631-icon-service-Logic-Apps.svg', category: 'integration' },
  { name: 'azure:event-hubs', provider: 'azure', service: 'event-hubs', file: '00039-icon-service-Event-Hubs.svg', category: 'integration' },
  { name: 'azure:event-grid', provider: 'azure', service: 'event-grid', file: '10206-icon-service-Event-Grid-Topics.svg', category: 'integration' },
  // security
  { name: 'azure:key-vault', provider: 'azure', service: 'key-vault', file: '10245-icon-service-Key-Vaults.svg', category: 'security' },
  { name: 'azure:defender-for-cloud', provider: 'azure', service: 'defender-for-cloud', file: '10241-icon-service-Microsoft-Defender-for-Cloud.svg', category: 'security' },
  { name: 'azure:sentinel', provider: 'azure', service: 'sentinel', file: '10248-icon-service-Azure-Sentinel.svg', category: 'security' },
  // management / ai / analytics / iot / devtools
  { name: 'azure:monitor', provider: 'azure', service: 'monitor', file: '00001-icon-service-Monitor.svg', category: 'management' },
  { name: 'azure:openai', provider: 'azure', service: 'openai', file: '03438-icon-service-Azure-OpenAI.svg', category: 'ai' },
  { name: 'azure:machine-learning', provider: 'azure', service: 'machine-learning', file: '10166-icon-service-Machine-Learning.svg', category: 'ai' },
  { name: 'azure:synapse', provider: 'azure', service: 'synapse', file: '00606-icon-service-Azure-Synapse-Analytics.svg', category: 'analytics' },
  { name: 'azure:databricks', provider: 'azure', service: 'databricks', file: '10787-icon-service-Azure-Databricks.svg', category: 'analytics' },
  { name: 'azure:data-factory', provider: 'azure', service: 'data-factory', file: '10126-icon-service-Data-Factories.svg', category: 'analytics' },
  { name: 'azure:iot-hub', provider: 'azure', service: 'iot-hub', file: '10182-icon-service-IoT-Hub.svg', category: 'iot' },
  { name: 'azure:devops', provider: 'azure', service: 'devops', file: '10261-icon-service-Azure-DevOps.svg', category: 'devtools' },

  // ------------------------------------------------------------------ GCP
  // GCP's official toolkit ships branded "Unique Icons" for a focused set of services (512px,
  // multi-color). These are the real service glyphs; category tiles are intentionally omitted.
  { name: 'gcp:compute-engine', provider: 'gcp', service: 'compute-engine', file: 'ComputeEngine-512-color-rgb.svg', category: 'compute' },
  { name: 'gcp:run', provider: 'gcp', service: 'run', file: 'CloudRun-512-color-rgb.svg', category: 'compute' },
  { name: 'gcp:gke', provider: 'gcp', service: 'gke', file: 'GKE-512-color.svg', category: 'containers' },
  { name: 'gcp:anthos', provider: 'gcp', service: 'anthos', file: 'Anthos-512-color.svg', category: 'containers' },
  { name: 'gcp:distributed-cloud', provider: 'gcp', service: 'distributed-cloud', file: 'DistributedCloud-512-color.svg', category: 'compute' },
  { name: 'gcp:ai-hypercomputer', provider: 'gcp', service: 'ai-hypercomputer', file: 'AIHypercomputer-512-color.svg', category: 'compute' },
  { name: 'gcp:storage', provider: 'gcp', service: 'storage', file: 'Cloud_Storage-512-color.svg', category: 'storage' },
  { name: 'gcp:hyperdisk', provider: 'gcp', service: 'hyperdisk', file: 'Hyperdisk-512-color.svg', category: 'storage' },
  { name: 'gcp:sql', provider: 'gcp', service: 'sql', file: 'CloudSQL-512-color.svg', category: 'database' },
  { name: 'gcp:spanner', provider: 'gcp', service: 'spanner', file: 'CloudSpanner-512-color.svg', category: 'database' },
  { name: 'gcp:alloydb', provider: 'gcp', service: 'alloydb', file: 'AlloyDB-512-color.svg', category: 'database' },
  { name: 'gcp:bigquery', provider: 'gcp', service: 'bigquery', file: 'BigQuery-512-color.svg', category: 'analytics' },
  { name: 'gcp:looker', provider: 'gcp', service: 'looker', file: 'Looker-512-color.svg', category: 'analytics' },
  { name: 'gcp:apigee', provider: 'gcp', service: 'apigee', file: 'Apigee-512-color-rgb.svg', category: 'integration' },
  { name: 'gcp:vertex-ai', provider: 'gcp', service: 'vertex-ai', file: 'VertexAI-512-color.svg', category: 'ai' },
  { name: 'gcp:security-command-center', provider: 'gcp', service: 'security-command-center', file: 'SecurityCommandCenter-512-color.svg', category: 'security' },
  { name: 'gcp:security-operations', provider: 'gcp', service: 'security-operations', file: 'SecOps-512-color-rgb.svg', category: 'security' },
  { name: 'gcp:threat-intelligence', provider: 'gcp', service: 'threat-intelligence', file: 'ThreatIntelligence-512-color.svg', category: 'security' },
  { name: 'gcp:mandiant', provider: 'gcp', service: 'mandiant', file: 'Mandiant-512-color.svg', category: 'security' },
];
