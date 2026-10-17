//! Неделя 6 — профиль пользователя по PDA.
//!
//! Адрес профиля не генерируется, а выводится из seeds ["profile", owner].
//! Профиль любого пользователя можно найти, зная только его кошелёк.

use anchor_lang::prelude::*;

declare_id!("7Q9t2PQmdYEZP6RTi8W93rsnuE1x4MubRMseei6RBJwD");

pub const PROFILE_SEED: &[u8] = b"profile";
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_BIO_LEN: usize = 200;

#[program]
pub mod profile {
    use super::*;

    pub fn create_profile(ctx: Context<CreateProfile>, name: String, bio: String) -> Result<()> {
        validate(&name, &bio)?;

        let profile = &mut ctx.accounts.profile;
        profile.owner = ctx.accounts.owner.key();
        profile.name = name;
        profile.bio = bio;
        profile.bump = ctx.bumps.profile;
        msg!("Профиль создан: {} (bump {})", profile.name, profile.bump);
        Ok(())
    }

    pub fn update_profile(ctx: Context<UpdateProfile>, name: String, bio: String) -> Result<()> {
        validate(&name, &bio)?;

        let profile = &mut ctx.accounts.profile;
        profile.name = name;
        profile.bio = bio;
        msg!("Профиль обновлён: {}", profile.name);
        Ok(())
    }
}

fn validate(name: &str, bio: &str) -> Result<()> {
    require!(!name.is_empty(), ProfileError::NameEmpty);
    require!(name.len() <= MAX_NAME_LEN, ProfileError::NameTooLong);
    require!(bio.len() <= MAX_BIO_LEN, ProfileError::BioTooLong);
    Ok(())
}

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Profile::INIT_SPACE,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, Profile>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [PROFILE_SEED, owner.key().as_ref()],
        bump = profile.bump,
        has_one = owner @ ProfileError::NotOwner
    )]
    pub profile: Account<'info, Profile>,
    pub owner: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub owner: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_BIO_LEN)]
    pub bio: String,
    pub bump: u8,
}

#[error_code]
pub enum ProfileError {
    #[msg("Имя не может быть пустым")]
    NameEmpty,
    #[msg("Имя длиннее 32 байт")]
    NameTooLong,
    #[msg("Описание длиннее 200 байт")]
    BioTooLong,
    #[msg("Изменять профиль может только его владелец")]
    NotOwner,
}
