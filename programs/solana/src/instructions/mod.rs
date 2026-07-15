//! Instruction domains and their shared authorization boundary.
//!
//! Account constraints are part of the public security model: callers do not
//! gain authority merely because another signer pays a transaction fee. Rent
//! destinations are pinned to protocol state and unsettled run accounts remain
//! open until a canonical base-layer receipt has been consumed.

pub mod economy_v2_instructions;
pub mod governance_instructions;
pub mod player_authorization;
pub mod player_funding_instructions;
pub mod progress_instructions;
pub mod run_lifecycle;
pub mod v2_instructions;

pub use economy_v2_instructions::*;
pub use governance_instructions::*;
pub use player_authorization::*;
pub use player_funding_instructions::*;
pub use progress_instructions::*;
pub use run_lifecycle::*;
pub use v2_instructions::*;
