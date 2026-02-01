-- Migration: Add onboarding_complete column to existing database
-- Run this ONCE if user_preferences table already exists

-- Add the column (SQLite allows adding columns to existing tables)
ALTER TABLE user_preferences ADD COLUMN onboarding_complete INTEGER DEFAULT 0;

-- Mark all existing users as onboarding complete (they already confirmed bottle size)
UPDATE user_preferences SET onboarding_complete = 1;
