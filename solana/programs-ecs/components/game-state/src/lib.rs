use bolt_lang::*;

declare_id!("8KQY8tw43tUVLofMM9H35cAWnpKptYsr5udX6TbWHjZt");

#[component]
#[derive(Default)]
pub struct GameState {
    /// La grille de jeu : 10 lignes x 8 colonnes = 80 octets 
    /// 1 case c'est 1 octets ( 8 bits)
    /// Chaque case est soit  0 , 1, 2, 3 ou 4
    pub blocks: [u8; 80], /// je stock ma grille sous forme de tableau de 80 cases c'est plus simple pour la redirecion et sqtockage 

    /// la prochaine ligne qui va être inseree en bas
    pub next_row: [u8; 8], // 8 cases pour la prochaine ligne ( 1 octet => )

    /// Score total de la partie
    pub score: u32,

    /// Combo en cours
    pub combo_counter: u8,

    /// Meilleur combo atteint dans la partie
    pub max_combo: u8,

    /// Nombre de coups joues
    pub move_count: u32,

    /// Seed pour la generation deterministe des lignes
    pub seed: u64,

    /// fin de partie 
    pub over: bool,
}