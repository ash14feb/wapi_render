-- CreateTable
CREATE TABLE `bot_rules` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `whatsapp_account_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `match_type` VARCHAR(191) NOT NULL DEFAULT 'CONTAINS',
    `trigger` VARCHAR(191) NOT NULL DEFAULT '',
    `reply_text` TEXT NOT NULL,
    `handoff` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bot_rules_tenant_id_idx`(`tenant_id`),
    INDEX `bot_rules_tenant_id_active_idx`(`tenant_id`, `active`),
    INDEX `bot_rules_tenant_id_whatsapp_account_id_idx`(`tenant_id`, `whatsapp_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bot_rules` ADD CONSTRAINT `bot_rules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bot_rules` ADD CONSTRAINT `bot_rules_whatsapp_account_id_fkey` FOREIGN KEY (`whatsapp_account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
