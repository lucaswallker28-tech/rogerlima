# Gestão de Mensalidades - Roger Lima

Aplicação responsiva em React/TypeScript com Supabase Auth e Postgres. Os cadastros reais ficam no banco online; o modo demonstração usa apenas exemplos fictícios em memória e não grava nem consulta o banco.

## Rodar localmente

1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env.local` e informe a URL do projeto Supabase e a chave **publishable/anon** do projeto.
3. Execute `npm install`, `npm test` e `npm run dev`.
4. No Supabase, execute `supabase/migrations/202611240001_initial.sql` no SQL Editor. Isso cria as tabelas, triggers, funções e políticas RLS.
5. Cadastre a conta do administrador em Authentication > Users. O trigger cria o perfil como aluno; copie o UUID do usuário e promova a primeira conta pelo SQL Editor:

   ```sql
   update public.profiles set role = 'admin' where id = 'UUID-DO-USUARIO';
   ```

6. Para cada pessoa da equipe, crie uma conta individual em Authentication > Users e altere `profiles.role` para `teacher` ou `admin`. Vincule o professor à turma pelo SQL Editor:

   ```sql
   update public.profiles set role = 'teacher' where id = 'UUID-DO-PROFESSOR';
   insert into public.class_teachers (class_id, teacher_id)
   values ('UUID-DA-TURMA', 'UUID-DO-PROFESSOR');
   ```

   Para o portal do aluno, vincule `students.auth_user_id` ao UUID correspondente:

   ```sql
   update public.students set auth_user_id = 'UUID-DO-ALUNO' where id = 'UUID-DO-CADASTRO';
   ```

   A associação aluno-turma é mantida pelo trigger do banco.

Nunca use a chave `service_role` no navegador, no `.env` com prefixo `VITE_`, nem em arquivos publicados. A chave publishable/anon foi projetada para o cliente e as permissões são aplicadas pelas políticas RLS.

## Marca e implantação

A foto de fundo enviada está instalada e é usada no login e nos cabeçalhos com degradê para preservar a leitura. O logotipo oficial ainda não está no projeto. O logotipo oficial ainda não está no projeto; adicione-o em `public/brand/roger-lima-logo.png`. Os caminhos podem ser alterados em `.env.local`. Sem o logotipo, a tela usa a marca textual. Não publique informações pessoais nem credenciais em repositório público.

Para publicar no GitHub Pages, ative Pages com fonte GitHub Actions e configure as variáveis de repositório `ENABLE_PAGES=true`, `SUPABASE_URL` e `SUPABASE_ANON_KEY`. O workflow `.github/workflows/pages.yml` testa e compila em cada atualização; o job de publicação só roda com `ENABLE_PAGES=true` e Pages configurado. A URL e a chave publishable/anon são públicas por natureza; nunca use `service_role` ou segredos em variáveis `VITE_`. Não envie `.env.local`.

## Funções implementadas e configuração necessária

- Login por email/senha Supabase, sincronização periódica (a cada 20 segundos) entre dispositivos; papéis e isolamento aluno/professor/admin em RLS. O aluno recebe um portal separado.
- Alunos, turmas, chamada, mensalidades manuais, pagamentos parciais, descontos, isenções, reversões, experimentais, conversão e exportação CSV.
- O status financeiro é calculado a partir do saldo e da data no fuso de Goiânia. Competência e data de pagamento são campos separados.
- Lembretes por WhatsApp apenas abrem a mensagem para revisão/envio pelo professor. Não há cobrança Pix nem envio automático.
- A demonstração é fictícia, em memória e somente leitura. Não há contas reais da equipe, logotipo oficial, projeto Supabase ou credenciais fornecidos; configure-os antes de usar dados de produção.

## Backup

O importador aceita JSON com listas `students`, `classes`, `charges`, `charge_adjustments`, `payments`, `attendance`, `experiments` e `makeups`. A prévia identifica possíveis duplicados por telefone/nome; a função `admin_import_backup` preserva competências, datas e relacionamentos, remapeando IDs e associando duplicados por telefone exato. Coincidências somente por nome exigem revisão manual para evitar juntar pessoas diferentes. Faça primeiro um backup do banco e valide o formato legado em uma cópia do projeto.

## Testes e validação de produção

`npm test` cobre o cálculo do status no vencimento, nos três dias anteriores, depois do vencimento e o ajuste do dia 31 em fevereiro. Para validar o fluxo completo, cadastre uma experimental, converta-a, edite plano/valor na ficha, registre a chamada, gere a mensalidade e faça uma baixa parcial. Teste também duas contas de aluno diferentes e a sincronização em dois dispositivos antes de publicar para uso real. Essas verificações de integração dependem de um projeto Supabase configurado.
