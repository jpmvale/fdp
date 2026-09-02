import { expect, test, type Page } from '@playwright/test';
import { fecharAbasExtras, outraPessoa } from './apoio';

/**
 * A fila e o perfil — CA-428 e CA-429.
 *
 * Estes dois entraram na suíte primeiro por um motivo específico: foram os dois
 * que a **RNF-106** apontou no primeiro dia em que ela existiu. Eram gates das
 * fases F1 e F4 do plano 03, as duas marcadas como concluídas, e nenhum dos
 * dois tinha teste. A regra nova serviu de mapa.
 *
 * Os dois são de TELA, e por isso são `E`: o que se verifica não é que o
 * servidor sabe o custo do abandono ou o elo de alguém — isso já é testado —,
 * é que a pessoa **lê** essas duas coisas antes de precisar delas.
 */

test.afterEach(fecharAbasExtras);

/**
 * Cria uma conta e deixa a sessão pronta nesta aba.
 *
 * O e-mail carrega o instante: a suíte roda contra UM servidor, e um e-mail
 * fixo faria o segundo teste esbarrar em `EMAIL_EM_USO` — falhando por causa do
 * teste anterior, que é a pior forma de falhar.
 */
async function comConta(page: Page, apelido: string): Promise<void> {
  const email = `${apelido.toLowerCase()}-${String(Date.now())}@exemplo.com`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar ou criar conta' }).click();
  // `exact`: sem ele, "Criar conta" casa por substring com "Entrar ou criar
  // conta", que continua no DOM atrás da folha.
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

  await page.getByLabel('apelido').fill(apelido);
  await page.getByLabel('e-mail').fill(email);
  await page.getByLabel('senha', { exact: true }).fill('senha-bem-comprida-1');
  await page.getByLabel('repita a senha').fill('senha-bem-comprida-1');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

  // Cadastrar NÃO entra: o produto devolve para a tela de login pedindo a senha
  // de novo, de propósito — é o que confirma que a senha digitada é a que a
  // pessoa acha que digitou. O E2E passa por isso porque a pessoa passa.
  await expect(page.getByText(/conta criada/i)).toBeVisible();
  await page.getByLabel('senha', { exact: true }).fill('senha-bem-comprida-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  // Agora sim: a home passa a dizer quem você é.
  await expect(page.getByText('entrando como')).toBeVisible();
}

test.describe('a fila', () => {
  test('CA-428: o custo do abandono aparece ANTES do botão de entrar', async ({ page }) => {
    await comConta(page, 'Ana');
    await page.goto('/');
    await page.getByRole('button', { name: 'Ranqueada' }).click();

    /**
     * A regra deste plano com mais chance de machucar quem não merecia.
     *
     * Descobrir a punição depois de tê-la levado é o desenho que faz alguém
     * abandonar o jogo, e não a partida. Por isso o critério é de TELA: o
     * servidor cobrar certo não adianta se ninguém foi avisado.
     */
    const aviso = page.getByText(/sair no meio de uma ranqueada/i);
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('último lugar');
    await expect(aviso).toContainText('25 pontos');

    // E a outra metade do aviso: queda de internet não é abandono. Sem ela, a
    // regra parece uma armadilha para quem joga do celular.
    await expect(aviso).toContainText(/queda de internet não conta/i);
  });

  test('a fila normal não pede conta, e diz quantos faltam', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Jogar agora' }).click();
    await page.locator('input').first().fill('Ana');
    await page.getByRole('button', { name: 'Entrar na mesa' }).click();

    // A promessa de I-1 vale também na fila: sem conta, sem instalar nada.
    await expect(page.getByText(/faltam \d+ para a mesa existir/i)).toBeVisible();
    await expect(page.getByText('1 pessoa')).toBeVisible();
  });

  test('a fila anda: quem entra depois faz o número subir na tela de quem já esperava', async ({ page, browser }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Jogar agora' }).click();
    await page.locator('input').first().fill('Ana');
    await page.getByRole('button', { name: 'Entrar na mesa' }).click();
    await expect(page.getByText('1 pessoa')).toBeVisible();

    const beto = await outraPessoa(browser);
    await beto.goto('/');
    await beto.getByRole('button', { name: 'Jogar agora' }).click();
    await beto.locator('input').first().fill('Beto');
    await beto.getByRole('button', { name: 'Entrar na mesa' }).click();

    // Sem isto a fila parece travada, que é o pior estado possível para uma
    // tela cuja única função é fazer alguém esperar.
    await expect(page.getByText('2 pessoas')).toBeVisible({ timeout: 3000 });
  });

  test('sair da fila devolve para a home, e o lugar é liberado', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Jogar agora' }).click();
    await page.locator('input').first().fill('Ana');
    await page.getByRole('button', { name: 'Entrar na mesa' }).click();
    await expect(page.getByText('1 pessoa')).toBeVisible();

    await page.getByRole('button', { name: 'Sair da fila' }).click();
    await expect(page.getByRole('button', { name: 'Criar sala' })).toBeVisible();
  });
});

test.describe('o perfil', () => {
  test('CA-429: quem nunca jogou ranqueada não tem seção de elo', async ({ page }) => {
    await comConta(page, 'Ana');
    await page.goto('/');
    await page.getByRole('button', { name: /meu perfil|perfil/i }).first().click();

    // Ausência de seção é a resposta honesta. Mostrar "1000, Prata" para quem
    // nunca entrou na fila daria a entender que a pessoa jogou e ficou
    // exatamente no meio, e não há legenda que desfaça essa leitura.
    await expect(page.getByText(/nenhuma partida ainda/i)).toBeVisible();
    await expect(page.getByText('elo', { exact: true })).toBeHidden();
    await expect(page.getByText('faixa', { exact: true })).toBeHidden();
  });
});
