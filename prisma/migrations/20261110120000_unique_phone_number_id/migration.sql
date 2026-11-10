-- A Meta phone_number_id identifies exactly one number globally, and inbound
-- webhooks route by it. It must not be claimable by more than one tenant.
DROP INDEX `whatsapp_accounts_tenant_id_phone_number_id_key` ON `whatsapp_accounts`;

CREATE UNIQUE INDEX `whatsapp_accounts_phone_number_id_key` ON `whatsapp_accounts`(`phone_number_id`);
