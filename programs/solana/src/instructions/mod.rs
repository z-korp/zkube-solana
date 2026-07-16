//! Instruction domains and their shared authorization boundary.
//!
//! Account constraints are part of the public security model: callers do not
//! gain authority merely because another signer pays a transaction fee. Rent
//! destinations are pinned to protocol state and ActiveRun remains open until
//! terminal state is atomically consumed and closed on the base layer.

pub mod content_instructions;
pub mod economy_instructions;
pub mod governance_instructions;
pub mod player_authorization;
pub mod player_funding_instructions;
pub mod progress_instructions;
pub mod run_lifecycle;

pub use content_instructions::*;
pub use economy_instructions::*;
pub use governance_instructions::*;
pub use player_authorization::*;
pub use player_funding_instructions::*;
pub use progress_instructions::*;
pub use run_lifecycle::*;
