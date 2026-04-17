use bolt_lang::*;

declare_id!("8KQY8tw43tUVLofMM9H35cAWnpKptYsr5udX6TbWHjZt");

#[component]
#[derive(Default)]
pub struct GameState {
    /// La grille de jeu : 10 lignes x 8 colonnes = 80 octets 
    /// 1 case c'est 1 octets ( 8 bits)
    /// Chaque case est soit  0 , 1, 2 ou 3 
    pub blocks: [u8; 80], /// je stock ma grille sous forme de tableau de 80 cases c'est plus simple pour la redirecion et sqtockage 

    /// la prochaine ligne qui va être insérée en bas
    pub next_row: [u8; 8], // 8 cases pour la prochaine ligne ( 1 octet => )

    /// Score total de la partie
    pub score: u32,

    /// Combo en cours (lignes effacées consécutives)
    pub combo_counter: u8,

    /// Meilleur combo atteint dans la partie
    pub max_combo: u8,

    /// Nombre de coups joués
    pub move_count: u32,

    /// Seed pour la génération déterministe des lignes
    pub seed: u64,

    /// La partie est-elle terminée ?
    pub over: bool,
}