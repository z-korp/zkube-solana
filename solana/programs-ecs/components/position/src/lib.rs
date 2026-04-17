use bolt_lang::*;

declare_id!("3peFAED3Mhvv4ADbaf5TgtJ3Enc26YS3d2be6mAiJ2AC");

#[component]
#[derive(Default)]
pub struct Position {
    pub x: i64,
    pub y: i64,
    pub z: i64,
    #[max_len(20)]
    pub description: String,
}