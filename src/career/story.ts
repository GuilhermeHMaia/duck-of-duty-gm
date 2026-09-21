import type { RegionId } from './missions';

export const SERGEANT = 'Sgt. Bico-de-Aço';

/** Falas mostradas antes da PRIMEIRA missão de cada região. */
export const REGION_INTRO: Record<RegionId, readonly string[]> = {
  lago: [
    'Recruta! Bem-vindo à Divisão Olho de Águia.',
    'A Legião Grasnante quer dominar todos os lagos do mundo. Começando pelo do seu avô.',
    'Aqui ninguém usa gatilho. Você mira com os OLHOS e atira piscando. Não me pergunte como.',
  ],
  pantano: [
    'Rastreamos a Legião até o Pântano da Neblina. Ninguém enxerga um palmo aqui.',
    'Ninguém... menos você. Onde você olha, a névoa abre.',
    'E cuidado com os fantasmas. Eles somem quando você menos espera.',
  ],
  floresta: [
    'Notícia ruim, recruta: a Legião aprendeu a atacar de noite.',
    'Notícia boa: descobrimos que o seu olhar funciona como lanterna.',
    'Onde você não olha, você não vê. E eles sabem disso.',
  ],
};

export const BRIEFINGS: Record<string, readonly string[]> = {
  'lago-1': [
    'Treino básico. Olhe para um pato até o anel da mira ficar verde.',
    'Aí feche os dois olhos por um instante. Sem piscar à toa, hein?',
    'Acabou a munição? Olhe para a caixa de munição ali no canto. Ou feche só o olho esquerdo. O direito troca de arma. Sim, é sério.',
  ],
  'lago-2': [
    'Uma revoada inteira vindo. Mantenha a calma e a precisão.',
    'Quero ver você vencer sem o super. Super é para os fracos. Brincadeira. Mais ou menos.',
  ],
  'lago-3': [
    'Eles estão mais rápidos e menos pacientes.',
    'Nenhum deles pode escapar para contar aos outros onde você está.',
  ],
  'lago-4': [
    'A Legião mandou os blindados. Tiro normal só faz cócegas neles.',
    'Abra essa boca, carregue o super e mostre quem manda no lago.',
  ],
  'floresta-1': [
    'Primeira noite na floresta. Mova o olhar devagar e procure.',
    'Pato que você não ilumina, pato que você não acerta.',
  ],
  'floresta-2': [
    'As sombras estão rápidas hoje. Não deixe nenhuma escapar.',
  ],
  'floresta-3': [
    'Esses de olho arregalado são os Tímidos. Odeiam luz.',
    'Fique com a lanterna neles tempo demais e eles disparam para longe. Seja rápido.',
  ],
  'floresta-4': [
    'Emboscada, recruta! Blindados, Tímidos e mais pato do que eu consigo contar.',
    'Se sobreviver a esta noite, conto um segredo sobre a Legião.',
  ],
  'pantano-1': [
    'Mova o olhar pela névoa. O pato que você não vê, você não acerta.',
  ],
  'pantano-2': [
    'Os Fantasmas do Brejo somem e reaparecem. Atire quando eles estiverem sólidos.',
  ],
  'pantano-3': [
    'Blindados atolados na lama e fantasmas por todo lado. Traga seu melhor rifle.',
  ],
  'pantano-4': [
    'É ELE, recruta. O General Grasnado em pessoa.',
    'O escudo dele é impenetrável... a não ser que você o encare nos olhos. Dois segundos, sem piscar.',
    'Quando o escudo cair, descarregue tudo. Rifle dói em dobro.',
  ],
};

/** Mostrado no resultado ao completar pela primeira vez a missão indicada. */
export const COMPLETION_HOOKS: Record<string, readonly string[]> = {
  'floresta-4': [
    'Muito bem, recruta. Interceptamos uma mensagem da Legião...',
    'Eles têm um general. E ele está escondido no pântano.',
  ],
  'pantano-4': [
    'O General caiu! Mas antes fugiu grasnando para a Base da Legião...',
    '(continua em breve)',
  ],
};
