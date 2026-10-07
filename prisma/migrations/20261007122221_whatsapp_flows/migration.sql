-- CreateTable
CREATE TABLE `whatsapp_flows` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `meta_flow_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `categories` TEXT NULL,
    `flow_json` LONGTEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `whatsapp_flows_tenant_id_idx`(`tenant_id`),
    INDEX `whatsapp_flows_meta_flow_id_idx`(`meta_flow_id`),
    UNIQUE INDEX `whatsapp_flows_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_flow_responses` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `flow_id` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `response_json` TEXT NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsapp_flow_responses_tenant_id_idx`(`tenant_id`),
    INDEX `whatsapp_flow_responses_tenant_id_flow_id_idx`(`tenant_id`, `flow_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `whatsapp_flows` ADD CONSTRAINT `whatsapp_flows_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsapp_flow_responses` ADD CONSTRAINT `whatsapp_flow_responses_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsapp_flow_responses` ADD CONSTRAINT `whatsapp_flow_responses_flow_id_fkey` FOREIGN KEY (`flow_id`) REFERENCES `whatsapp_flows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
